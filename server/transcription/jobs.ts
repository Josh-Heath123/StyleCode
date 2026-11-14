import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { wavHeader, WAV_HEADER_BYTES } from '../../src/workspace/audio/wav.ts';
import { consentFor, consentState } from '../../src/workspace/model/consent.ts';
import type { CompanyWorkspace, EngineUsed } from '../../src/workspace/model/index.ts';
import { isRecording, RECORDING_SAMPLE_RATE } from '../../src/workspace/model/recordings.ts';
import { segmentsFrom, type TranscribedSegment } from '../../src/workspace/transcription/combine.ts';
import { readDiarization } from '../../src/workspace/transcription/sherpa.ts';
import { readWhisperJson } from '../../src/workspace/transcription/whisper.ts';
import { heavyJobs, type HeavyJobs, type HeavyKind } from '../shared/heavy.ts';
import { RequestError } from '../shared/requests.ts';
import { isSafeId, type WorkspaceStore } from '../workspace/store.ts';
import { installedPaths, SPEAKER_ENGINE, SPEAKER_THRESHOLD, TRANSCRIBER } from './install.ts';
import { estimate, readSettings, recordSpeed } from './settings.ts';

/**
 * Transcription jobs (Phase 3 brief, decision 17): a job runs in the local
 * server, so it carries on if the page closes.
 *
 * - **Before starting,** the server checks that consent allows transcription
 *   now (C1, C8) and that the recordings are the session's and finished, and
 *   gives an estimate from this computer's past speeds.
 * - **One heavy job at a time** (decision 10, as settled at WP3): a job waits
 *   for any other transcription or extraction, and says so.
 * - **Working files** (the joined audio, the programs' output) go in the
 *   company's folder, never the system's temporary folder, and are deleted
 *   when the job ends. Leftovers are removed at start-up.
 * - **The programs** run with argument arrays, never through a shell. What
 *   they print is the client's words, so it is never logged or kept: only
 *   their progress is read, and the speaker turns.
 * - **The result** (segments, no audio) is kept in the company's folder
 *   until the page adds it or the consultant discards it. **Cancel** stops
 *   the programs and keeps nothing.
 */

export type JobState = 'waiting' | 'preparing' | 'transcribing' | 'speakers' | 'finishing' | 'done' | 'failed' | 'cancelled';

export interface JobView {
  id: string;
  sessionId: string;
  recordingIds: string[];
  state: JobState;
  /** While waiting: what for. */
  waitingFor: HeavyKind | null;
  /** From 0 to 1, across both programs. */
  progress: number;
  audioMs: number;
  estimateMs: number;
  createdAt: string;
  /** When it stopped waiting and started work. */
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

/** Where each recording sits in the joined audio, so a segment's time finds its recording (decision 21). */
export interface RecordingSpan {
  fileId: string;
  offsetMs: number;
  durationMs: number;
}

export interface JobResult {
  format: typeof RESULT_FORMAT;
  version: 1;
  jobId: string;
  sessionId: string;
  recordingIds: string[];
  spans: RecordingSpan[];
  segments: TranscribedSegment[];
  transcriber: EngineUsed;
  speakers: EngineUsed;
  audioMs: number;
  finishedAt: string;
}

const RESULT_FORMAT = 'stylecode-transcription-result';
const JOB_ID = /^tj_[0-9a-f]{16}$/;

interface Job extends JobView {
  companyId: string;
  abort: AbortController;
  transcribeShare: number;
}

/** How a program is started: the real one, or the fake for tests. */
export interface Programs {
  whisper: { command: string; prefix: string[] };
  speakers: { command: string; prefix: string[] };
  whisperModel: string;
  segmentation: string;
  embedding: string;
  /** Whether everything is there to run. */
  installed: () => boolean;
}

/** The fake engine (`fake/engine.mjs`), when STYLECODE_TRANSCRIPTION_FAKE is set: tests only. */
export const FAKE = process.env.STYLECODE_TRANSCRIPTION_FAKE === '1';

/** The fake engine, run by this Node: it answers with recorded output (`fake/engine.mjs`). */
export function fakePrograms(): Programs {
  const fake = join(import.meta.dirname, 'fake', 'engine.mjs');
  return {
    whisper: { command: process.execPath, prefix: [fake, 'whisper'] },
    speakers: { command: process.execPath, prefix: [fake, 'speakers'] },
    whisperModel: 'fake-model',
    segmentation: 'fake-segmentation',
    embedding: 'fake-embedding',
    installed: () => true,
  };
}

export function programs(): Programs {
  if (FAKE) return fakePrograms();
  const paths = installedPaths();
  return {
    whisper: { command: paths.whisperCli, prefix: [] },
    speakers: { command: paths.diarization, prefix: [] },
    whisperModel: paths.whisperModel,
    segmentation: paths.segmentation,
    embedding: paths.embedding,
    installed: () => Object.values(paths).every((p) => existsSync(p)),
  };
}

const THREADS = Math.max(1, Math.min(8, availableParallelism()));

/** What a program printed about its progress, from 0 to 1, or null. Nothing else it prints is read. */
export function progressIn(line: string): number | null {
  const m = /progress\D{0,4}(\d+(?:\.\d+)?)\s*%/i.exec(line);
  return m ? Math.min(1, Number(m[1]) / 100) : null;
}

export class TranscriptionJobs {
  private readonly jobs = new Map<string, Job>();

  constructor(
    private readonly store: WorkspaceStore,
    private readonly heavy: HeavyJobs = heavyJobs,
    private readonly engines: () => Programs = programs,
  ) {}

  private folder(companyId: string): string {
    return join(this.store.companyFolder(companyId), 'transcriptions');
  }

  private resultPath(companyId: string, jobId: string): string {
    if (!JOB_ID.test(jobId)) throw new RequestError('Invalid id.', 400);
    return join(this.folder(companyId), `${jobId}.json`);
  }

  /** At start-up: removes every company's working folders, left by a job the server stopped mid-way. */
  async clearLeftovers(): Promise<void> {
    const companies = join(this.store.root, 'companies');
    for (const id of await readdir(companies).catch(() => [] as string[])) {
      if (!isSafeId(id)) continue;
      for (const name of await readdir(this.folder(id)).catch(() => [] as string[])) {
        if (name.startsWith('work-') || name.endsWith('.tmp'))
          await rm(join(this.folder(id), name), { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }).catch(
            () => undefined,
          );
      }
    }
  }

  private view(job: Job): JobView {
    const { companyId: _c, abort: _a, transcribeShare: _t, ...view } = job;
    return { ...view, recordingIds: [...view.recordingIds] };
  }

  /**
   * Checks and queues a transcription of a session's recordings, in the
   * order given. Refused without consent to transcription now, for
   * recordings that aren't the session's or haven't stopped, or while the
   * session already has a job going.
   */
  async start(companyId: string, sessionId: unknown, recordingIds: unknown): Promise<JobView> {
    if (!isSafeId(sessionId)) throw new RequestError('Invalid id.', 400);
    if (!Array.isArray(recordingIds) || !recordingIds.length || !recordingIds.every(isSafeId))
      throw new RequestError('Choose the recordings to transcribe.', 400);
    if (new Set(recordingIds).size !== recordingIds.length) throw new RequestError('A recording is named twice.', 400);
    if (!this.engines().installed()) throw new RequestError('Transcription isn’t set up on this computer.', 409);
    const opened = await this.store.read(companyId);
    const problem = jobProblem(opened.workspace, sessionId, recordingIds as string[]);
    if (problem) throw new RequestError(problem, 409);
    if ([...this.jobs.values()].some((j) => j.companyId === companyId && j.sessionId === sessionId && !isOver(j.state)))
      throw new RequestError('This session is being transcribed already.', 409);
    const audioMs = (recordingIds as string[]).reduce((n, id) => n + (opened.workspace.files[id].audio?.durationMs ?? 0), 0);
    const guess = estimate(audioMs, (await readSettings()).speeds);
    const job: Job = {
      id: `tj_${randomBytes(8).toString('hex')}`,
      companyId,
      sessionId,
      recordingIds: [...(recordingIds as string[])],
      state: 'waiting',
      waitingFor: null,
      progress: 0,
      audioMs,
      estimateMs: guess.totalMs,
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      error: null,
      abort: new AbortController(),
      transcribeShare: guess.totalMs ? guess.transcribeMs / guess.totalMs : 0.5,
    };
    this.jobs.set(job.id, job);
    void this.run(job);
    return this.view(job);
  }

  private async run(job: Job): Promise<void> {
    const work = join(this.folder(job.companyId), `work-${job.id}`);
    try {
      await this.heavy.run(
        'transcription',
        async () => {
          job.waitingFor = null;
          job.startedAt = new Date().toISOString();
          job.state = 'preparing';
          await mkdir(work, { recursive: true });
          const { path: audio, spans } = await this.joinAudio(job, work);
          const engines = this.engines();

          job.state = 'transcribing';
          const startedTranscribing = Date.now();
          await this.runProgram(
            job,
            engines.whisper,
            [
              '-m',
              engines.whisperModel,
              '-f',
              audio,
              '-l',
              'en',
              '-t',
              String(THREADS),
              '--max-context',
              '0',
              '-ojf',
              '-of',
              join(work, 'words'),
              '-pp',
            ],
            (p) => (job.progress = p * job.transcribeShare),
          );
          const words = readWhisperJson(JSON.parse(await readFile(join(work, 'words.json'), 'utf8')));
          const transcribeMs = Date.now() - startedTranscribing;

          job.state = 'speakers';
          const startedSpeakers = Date.now();
          const turnsOut = await this.runProgram(
            job,
            engines.speakers,
            [
              `--segmentation.pyannote-model=${engines.segmentation}`,
              `--embedding.model=${engines.embedding}`,
              `--segmentation.num-threads=${THREADS}`,
              `--embedding.num-threads=${THREADS}`,
              `--clustering.cluster-threshold=${SPEAKER_THRESHOLD}`,
              audio,
            ],
            (p) => (job.progress = job.transcribeShare + p * (1 - job.transcribeShare)),
          );
          const speakersMs = Date.now() - startedSpeakers;

          job.state = 'finishing';
          const result: JobResult = {
            format: RESULT_FORMAT,
            version: 1,
            jobId: job.id,
            sessionId: job.sessionId,
            recordingIds: job.recordingIds,
            spans,
            segments: segmentsFrom(words, readDiarization(turnsOut)),
            transcriber: TRANSCRIBER,
            speakers: SPEAKER_ENGINE,
            audioMs: job.audioMs,
            finishedAt: new Date().toISOString(),
          };
          const path = this.resultPath(job.companyId, job.id);
          await writeFile(`${path}.tmp`, JSON.stringify(result), { mode: 0o600 });
          await rename(`${path}.tmp`, path);
          await recordSpeed({ audioMs: job.audioMs, transcribeMs, speakersMs, at: result.finishedAt }).catch(() => undefined);
        },
        {
          signal: job.abort.signal,
          onWait: (behind) => {
            job.waitingFor = behind;
          },
        },
      );
      job.state = 'done';
      job.progress = 1;
    } catch (error) {
      if (job.abort.signal.aborted) job.state = 'cancelled';
      else {
        job.state = 'failed';
        job.error = error instanceof RequestError ? error.message : 'The transcription stopped with an error. Try again.';
      }
    } finally {
      job.finishedAt = new Date().toISOString();
      job.waitingFor = null;
      await rm(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined);
    }
  }

  /** Joins the recordings' sound into one WAV in the working folder, in order. */
  private async joinAudio(job: Job, work: string): Promise<{ path: string; spans: RecordingSpan[] }> {
    const path = join(work, 'audio.wav');
    const out = await open(path, 'wx', 0o600);
    const spans: RecordingSpan[] = [];
    let sound = 0;
    try {
      await out.write(wavHeader(0, RECORDING_SAMPLE_RATE), 0, WAV_HEADER_BYTES, 0);
      for (const fileId of job.recordingIds) {
        const source = join(this.store.companyFolder(job.companyId), 'files', fileId);
        const size = (await stat(source)).size;
        const bytes = Math.max(0, size - WAV_HEADER_BYTES) & ~1;
        spans.push({
          fileId,
          offsetMs: Math.round((sound / 2 / RECORDING_SAMPLE_RATE) * 1000),
          durationMs: Math.round((bytes / 2 / RECORDING_SAMPLE_RATE) * 1000),
        });
        for await (const chunk of createReadStream(source, { start: WAV_HEADER_BYTES, end: WAV_HEADER_BYTES + bytes - 1 })) {
          if (job.abort.signal.aborted) throw new Error('Cancelled.');
          await out.write(chunk as Buffer, 0, (chunk as Buffer).length, WAV_HEADER_BYTES + sound);
          sound += (chunk as Buffer).length;
        }
      }
      await out.write(wavHeader(sound, RECORDING_SAMPLE_RATE), 0, WAV_HEADER_BYTES, 0);
    } finally {
      await out.close();
    }
    return { path, spans };
  }

  /** Runs a program to the end, reading only its progress; gives what it printed to stdout. */
  private runProgram(
    job: Job,
    program: { command: string; prefix: string[] },
    args: string[],
    onProgress: (p: number) => void,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      if (job.abort.signal.aborted) return reject(new Error('Cancelled.'));
      const child = spawn(program.command, [...program.prefix, ...args], {
        windowsHide: true,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        signal: job.abort.signal,
      });
      const out: Buffer[] = [];
      child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
      let pending = '';
      child.stderr.on('data', (chunk: Buffer) => {
        pending += chunk.toString('utf8');
        const lines = pending.split(/\r?\n|\r/);
        pending = lines.pop() ?? '';
        for (const line of lines) {
          const p = progressIn(line);
          if (p !== null) onProgress(p);
        }
        if (pending.length > 4096) pending = '';
      });
      child.on('error', (error) =>
        reject(job.abort.signal.aborted ? error : new RequestError('A transcription program couldn’t start.', 500)),
      );
      child.on('close', (code) => {
        if (job.abort.signal.aborted) return reject(new Error('Cancelled.'));
        if (code !== 0) return reject(new RequestError(`A transcription program stopped with an error (code ${code}).`, 500));
        resolve(Buffer.concat(out).toString('utf8'));
      });
    });
  }

  /** A company's jobs: those running or ended since the server started, and every result kept on disk. */
  async list(companyId: string): Promise<JobView[]> {
    const running = [...this.jobs.values()].filter((j) => j.companyId === companyId).map((j) => this.view(j));
    const kept: JobView[] = [];
    for (const name of await readdir(this.folder(companyId)).catch(() => [] as string[])) {
      const id = name.replace(/\.json$/, '');
      if (!JOB_ID.test(id) || name !== `${id}.json` || running.some((j) => j.id === id)) continue;
      const result = await this.result(companyId, id).catch(() => null);
      if (!result) continue;
      kept.push({
        id,
        sessionId: result.sessionId,
        recordingIds: result.recordingIds,
        state: 'done',
        waitingFor: null,
        progress: 1,
        audioMs: result.audioMs,
        estimateMs: 0,
        createdAt: result.finishedAt,
        startedAt: null,
        finishedAt: result.finishedAt,
        error: null,
      });
    }
    return [...running, ...kept];
  }

  get(companyId: string, jobId: string): JobView {
    const job = this.jobs.get(jobId);
    if (!job || job.companyId !== companyId) throw new RequestError('There is no such transcription.', 404);
    return this.view(job);
  }

  /** Stops a job: its programs are stopped, and nothing it made is kept. */
  cancel(companyId: string, jobId: string): JobView {
    const job = this.jobs.get(jobId);
    if (!job || job.companyId !== companyId) throw new RequestError('There is no such transcription.', 404);
    if (!isOver(job.state)) job.abort.abort(new Error('Cancelled.'));
    return this.view(job);
  }

  async result(companyId: string, jobId: string): Promise<JobResult> {
    let text: string;
    try {
      text = await readFile(this.resultPath(companyId, jobId), 'utf8');
    } catch {
      throw new RequestError('There is no such transcript.', 404);
    }
    const result = JSON.parse(text) as JobResult;
    if (result?.format !== RESULT_FORMAT || result.jobId !== jobId) throw new RequestError('The transcript can’t be read.', 422);
    return result;
  }

  /** Discards a job's result, once it is added or the consultant doesn't want it; cancels it if still going. */
  async discard(companyId: string, jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (job && job.companyId === companyId) {
      if (!isOver(job.state)) job.abort.abort(new Error('Cancelled.'));
      this.jobs.delete(jobId);
    }
    await rm(this.resultPath(companyId, jobId), { force: true, maxRetries: 5, retryDelay: 200 });
  }

  /** The job going now, in any company, for the status. */
  busy(): JobView | null {
    const job = [...this.jobs.values()].find((j) => !isOver(j.state));
    return job ? this.view(job) : null;
  }
}

const isOver = (state: JobState) => state === 'done' || state === 'failed' || state === 'cancelled';

/** Why a session's recordings can't be transcribed now, or null if they can (decisions 16 and 17). */
export function jobProblem(ws: CompanyWorkspace, sessionId: string, recordingIds: readonly string[]): string | null {
  if (!Object.hasOwn(ws.sessions, sessionId)) return 'The session does not exist.';
  const record = consentFor(ws, sessionId);
  const state = record && record.confirmed ? consentState(record) : null;
  if (!state) return 'Fill in and confirm the consent form for this session first.';
  if (state.withdrawn) return 'The client withdrew consent for this session.';
  if (!state.given.transcription) return 'The client did not agree to transcription.';
  for (const id of recordingIds) {
    const file = Object.hasOwn(ws.files, id) ? ws.files[id] : undefined;
    if (!isRecording(file) || file.owner.kind !== 'session' || file.owner.sessionId !== sessionId)
      return 'A recording to transcribe isn’t one of this session’s.';
    if (file.audio.state !== 'finished') return 'Stop the recording before transcribing it.';
  }
  return null;
}
