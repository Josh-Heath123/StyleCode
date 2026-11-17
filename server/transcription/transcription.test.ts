import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { wavHeader } from '../../src/workspace/audio/wav.ts';
import { amendConsent } from '../../src/workspace/model/consent.ts';
import { consentRecord, sampleWorkspace } from '../../src/workspace/model/fixtures.ts';
import type { CompanyWorkspace } from '../../src/workspace/model/index.ts';
import { addRecordingFile, startRecording, DEFAULT_RECORDING_SETTINGS } from '../../src/workspace/model/recordings.ts';
import { HeavyJobs } from '../shared/heavy.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { fakePrograms, jobProblem, progressIn, TranscriptionJobs, type JobView } from './jobs.ts';
import { estimate, FIRST_GUESS, readSettings } from './settings.ts';

/**
 * Transcription jobs (Phase 3 brief, decisions 10, 16, 17 and 19), run with
 * the fake engine: recorded output of the role-played Karoo Freight kick-off.
 */

let root: string;
let store: WorkspaceStore;
let heavy: HeavyJobs;
let jobs: TranscriptionJobs;
const AT = '2026-11-05T08:00:00.000Z';
/** The fake GPU's temperature: none unless a test sets one. */
let temperature: number | null = null;
const cooling = { read: async () => temperature, everyMs: 20 };

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'stylecode-transcription-'));
  mkdirSync(join(root, 'companies'));
  process.env.STYLECODE_TRANSCRIPTION_SETTINGS = join(root, 'transcription.json');
  delete process.env.FAKE_ENGINE_STEP_MS;
  delete process.env.FAKE_ENGINE_FAIL;
  store = new WorkspaceStore(root, { retry: { attempts: 2, delayMs: 1 } });
  heavy = new HeavyJobs();
  jobs = new TranscriptionJobs(store, heavy, fakePrograms, cooling);
});
afterEach(() => {
  delete process.env.STYLECODE_TRANSCRIPTION_SETTINGS;
  delete process.env.FAKE_ENGINE_STEP_MS;
  delete process.env.FAKE_ENGINE_FAIL;
  rmSync(root, { recursive: true, force: true });
});

/** A client with one session whose consent allows recording and transcription, and a finished 5-second recording. */
async function client(): Promise<{ id: string; ws: CompanyWorkspace; revision: string; fileId: string }> {
  const opened = await store.create({ name: 'Karoo Freight' });
  const id = opened.workspace.company.id;
  const sample = sampleWorkspace();
  let ws: CompanyWorkspace = {
    ...opened.workspace,
    engagements: { en_1: { ...sample.engagements.en_1, companyId: id } },
    sessions: { se_1: { ...sample.sessions.se_1 } },
    participants: { pa_client: { ...sample.participants.pa_client, speakerLabels: [] } },
    consents: {
      cr_1: consentRecord({
        given: { audioRecording: true, transcription: true, aiLocal: false, aiExternal: false, externalProvider: null },
        lockedAt: null,
      }),
    },
  };
  const fileId = 'fi_tone5s';
  const added = addRecordingFile(
    ws,
    'se_1',
    { id: fileId, name: 'kickoff.wav', durationMs: 5000, sizeBytes: 44 + 160_000 },
    'Sam',
    AT,
  );
  if (!added.ok) throw new Error(added.error);
  ws = added.value.workspace;
  writeFileSync(join(root, 'companies', id, 'files', fileId), Buffer.concat([wavHeader(160_000, 16_000), Buffer.alloc(160_000)]));
  const saved = await store.save(id, ws, opened.revision, true);
  return { id, ws, revision: saved.revision, fileId };
}

async function until(read: () => JobView, done: (j: JobView) => boolean, ms = 15_000): Promise<JobView> {
  const started = Date.now();
  while (Date.now() - started < ms) {
    const view = read();
    if (done(view)) return view;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`Timed out: ${JSON.stringify(read())}`);
}

const over = (j: JobView) => ['done', 'failed', 'cancelled'].includes(j.state);

describe('progress, estimates and one heavy job at a time', () => {
  it('reads only the progress the programs print', () => {
    expect(progressIn('whisper_print_progress_callback: progress =  45%')).toBe(0.45);
    expect(progressIn('progress 12.50%')).toBe(0.125);
    expect(progressIn('Thanks for making the time.')).toBeNull();
    expect(progressIn('We moved 45% of the loads by progress reports')).toBeNull();
  });

  it('estimates from this computer’s past runs, speakers at their slowest, and from WP3’s figures before any', () => {
    const first = estimate(3_600_000, []);
    expect(first.transcribeMs).toBe(Math.round(3_600_000 * FIRST_GUESS.transcribePerAudio + 30_000));
    expect(first.speakersMs).toBe(Math.round(3_600_000 * FIRST_GUESS.speakersPerAudio + 30_000));
    const speeds = [
      { audioMs: 1000, transcribeMs: 40, speakersMs: 150, at: AT },
      { audioMs: 1000, transcribeMs: 50, speakersMs: 350, at: AT },
      { audioMs: 1000, transcribeMs: 60, speakersMs: 200, at: AT },
    ];
    expect(estimate(10_000, speeds)).toEqual({ transcribeMs: 500, speakersMs: 3500, totalMs: 4000 });
  });

  it('runs heavy jobs one at a time, in order, saying what each waits for', async () => {
    const order: string[] = [];
    let release!: () => void;
    const first = heavy.run('extraction', () =>
      new Promise<void>((r) => (release = r)).then(() => void order.push('extraction')),
    );
    let waitedFor: string | null = null;
    const second = heavy.run('transcription', async () => void order.push('transcription'), { onWait: (k) => (waitedFor = k) });
    expect(waitedFor).toBe('extraction');
    expect(heavy.current()).toBe('extraction');
    const abort = new AbortController();
    const third = heavy.run('transcription', async () => void order.push('never'), { signal: abort.signal });
    abort.abort(new Error('Cancelled.'));
    await expect(third).rejects.toThrow('Cancelled.');
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['extraction', 'transcription']);
    expect(heavy.current()).toBeNull();
  });
});

describe('a transcription job, with the fake engine', () => {
  it('transcribes, puts words and speakers together, keeps the result and removes its working files', async () => {
    const c = await client();
    const started = await jobs.start(c.id, 'se_1', [c.fileId]);
    expect(started).toMatchObject({ audioMs: 5000, recordingIds: [c.fileId] });
    expect(['waiting', 'preparing']).toContain(started.state);
    expect(started.estimateMs).toBeGreaterThan(0);
    const done = await until(() => jobs.get(c.id, started.id), over);
    expect(done).toMatchObject({ state: 'done', progress: 1, error: null });
    const result = await jobs.result(c.id, started.id);
    expect(result.spans).toEqual([{ fileId: c.fileId, offsetMs: 0, durationMs: 5000 }]);
    expect(result.transcriber).toEqual({ name: 'whisper.cpp', version: '1.9.5', models: ['large-v3-turbo-q5_0'] });
    expect(result.segments[0]).toMatchObject({
      speakerLabel: 'Speaker 1',
      startMs: 880,
      text: expect.stringMatching(/^Morning, everyone\. Thanks for making the time\./),
    });
    // "Morning," came back at 0.60: below 0.8, it is marked by its letters.
    const [first] = result.segments;
    expect(first.unsureWords.map(([a, b]) => first.text.slice(a, b))).toContain('Morning');
    const folder = join(root, 'companies', c.id, 'transcriptions');
    expect(readdirSync(folder)).toEqual([`${started.id}.json`]);
    expect((await jobs.list(c.id)).map((j) => j.id)).toEqual([started.id]);
    expect((await readSettings()).speeds).toHaveLength(1);
    // Nothing it printed is kept beyond the result.
    expect(readFileSync(join(folder, `${started.id}.json`), 'utf8')).not.toContain('progress');
    await jobs.discard(c.id, started.id);
    expect(readdirSync(folder)).toEqual([]);
  });

  it('keeps a result across a restart of the server, listed for the session', async () => {
    const c = await client();
    const started = await jobs.start(c.id, 'se_1', [c.fileId]);
    await until(() => jobs.get(c.id, started.id), over);
    const restarted = new TranscriptionJobs(store, heavy, fakePrograms, cooling);
    expect(await restarted.list(c.id)).toMatchObject([
      { id: started.id, sessionId: 'se_1', state: 'done', recordingIds: [c.fileId] },
    ]);
  });

  it('waits behind an extraction run, saying so', async () => {
    const c = await client();
    let release!: () => void;
    const extraction = heavy.run('extraction', () => new Promise<void>((r) => (release = r)));
    const started = await jobs.start(c.id, 'se_1', [c.fileId]);
    expect(jobs.get(c.id, started.id)).toMatchObject({ state: 'waiting', waitingFor: 'extraction' });
    release();
    await extraction;
    expect((await until(() => jobs.get(c.id, started.id), over)).state).toBe('done');
  });

  it('lets a hot GPU cool before starting, holding the slot and saying the temperature; or starts at once when told (decision 10)', async () => {
    const c = await client();
    temperature = 92;
    try {
      const started = await jobs.start(c.id, 'se_1', [c.fileId]);
      let job = await until(
        () => jobs.get(c.id, started.id),
        (j) => j.coolingC === 92,
      );
      expect(job).toMatchObject({ state: 'waiting', startedAt: null });
      expect(heavy.current()).toBe('transcription');
      temperature = 80;
      job = await until(
        () => jobs.get(c.id, started.id),
        (j) => j.coolingC === 80,
      );
      expect(job.state).toBe('waiting');
      temperature = 74;
      job = await until(() => jobs.get(c.id, started.id), over);
      expect(job).toMatchObject({ state: 'done', coolingC: null });

      temperature = 95;
      const again = await jobs.start(c.id, 'se_1', [c.fileId]);
      await until(
        () => jobs.get(c.id, again.id),
        (j) => j.coolingC === 95,
      );
      expect(jobs.startNow(c.id, again.id).noCooling).toBe(true);
      expect((await until(() => jobs.get(c.id, again.id), over)).state).toBe('done');
    } finally {
      temperature = null;
    }
  });

  it('cancels: stops the programs and keeps nothing', async () => {
    const c = await client();
    process.env.FAKE_ENGINE_STEP_MS = '400';
    const started = await jobs.start(c.id, 'se_1', [c.fileId]);
    await until(
      () => jobs.get(c.id, started.id),
      (j) => j.state === 'transcribing',
    );
    jobs.cancel(c.id, started.id);
    expect((await until(() => jobs.get(c.id, started.id), over)).state).toBe('cancelled');
    await until(
      () => jobs.get(c.id, started.id),
      () => readdirSync(join(root, 'companies', c.id, 'transcriptions')).length === 0,
    );
  });

  it('says when a program fails, and keeps nothing', async () => {
    const c = await client();
    process.env.FAKE_ENGINE_FAIL = 'speakers';
    const started = await jobs.start(c.id, 'se_1', [c.fileId]);
    const failed = await until(() => jobs.get(c.id, started.id), over);
    expect(failed).toMatchObject({ state: 'failed', error: 'A transcription program stopped with an error (code 3).' });
    expect(existsSync(join(root, 'companies', c.id, 'transcriptions', `${started.id}.json`))).toBe(false);
  });

  it('refuses without consent to transcription, after a withdrawal, or for a recording still going (decision 16)', async () => {
    const c = await client();
    const off = structuredClone(c.ws);
    off.consents.cr_1.given.transcription = false;
    expect(jobProblem(off, 'se_1', [c.fileId])).toBe('The client did not agree to transcription.');
    const withdrawn = structuredClone(c.ws);
    const amended = amendConsent(withdrawn.consents.cr_1, {
      id: 'am_1',
      kind: 'withdrawal',
      by: 'Sam',
      at: '2026-11-05T09:00:00.000Z',
      reason: 'Asked to stop.',
    });
    if (!amended.ok) throw new Error(amended.error);
    withdrawn.consents.cr_1 = amended.value;
    expect(jobProblem(withdrawn, 'se_1', [c.fileId])).toBe('The client withdrew consent for this session.');
    const going = startRecording(
      c.ws,
      'se_1',
      { id: 'fi_going', settings: DEFAULT_RECORDING_SETTINGS },
      'Sam',
      '2026-11-05T09:00:00.000Z',
    );
    if (!going.ok) throw new Error(going.error);
    expect(jobProblem(going.value.workspace, 'se_1', ['fi_going'])).toBe('Stop the recording before transcribing it.');
    expect(jobProblem(c.ws, 'se_1', ['fi_other'])).toBe('A recording to transcribe isn’t one of this session’s.');
    await expect(jobs.start(c.id, 'se_1', ['fi_other'])).rejects.toMatchObject({ status: 409 });
  });

  it('runs one job per session, and removes working files a stopped server left', async () => {
    const c = await client();
    process.env.FAKE_ENGINE_STEP_MS = '200';
    const started = await jobs.start(c.id, 'se_1', [c.fileId]);
    await expect(jobs.start(c.id, 'se_1', [c.fileId])).rejects.toMatchObject({ status: 409 });
    jobs.cancel(c.id, started.id);
    await until(() => jobs.get(c.id, started.id), over);
    const left = join(root, 'companies', c.id, 'transcriptions', 'work-tj_0123456789abcdef');
    mkdirSync(left, { recursive: true });
    writeFileSync(join(left, 'audio.wav'), 'x');
    await jobs.clearLeftovers();
    expect(existsSync(left)).toBe(false);
  });

  it('cancels a job, and discards a result, once it can no longer be added: after a withdrawal, or with its session gone (decisions 16 and 25)', async () => {
    const c = await client();
    // A result waiting to be added, then consent withdrawn.
    const first = await jobs.start(c.id, 'se_1', [c.fileId]);
    await until(() => jobs.get(c.id, first.id), over);
    const withdrawn = structuredClone(c.ws);
    const amended = amendConsent(withdrawn.consents.cr_1, {
      id: 'am_1',
      kind: 'withdrawal',
      by: 'Sam',
      at: '2026-11-05T09:00:00.000Z',
      reason: 'Asked to stop.',
    });
    if (!amended.ok) throw new Error(amended.error);
    withdrawn.consents.cr_1 = amended.value;
    const saved = await store.save(c.id, withdrawn, c.revision, true);
    expect(await jobs.list(c.id)).toEqual([]);
    expect(existsSync(join(root, 'companies', c.id, 'transcriptions', `${first.id}.json`))).toBe(false);

    // A job still going when its session is deleted: cancelled, keeping nothing.
    const again = await store.save(c.id, c.ws, saved.revision, true);
    process.env.FAKE_ENGINE_STEP_MS = '300';
    const second = await jobs.start(c.id, 'se_1', [c.fileId]);
    const gone = structuredClone(c.ws);
    delete (gone.sessions as Record<string, unknown>).se_1;
    gone.files = {};
    gone.participants = {};
    gone.consents = {};
    await store.save(c.id, gone, again.revision, true);
    await jobs.list(c.id);
    expect(await until(() => jobs.get(c.id, second.id), over)).toMatchObject({ state: 'cancelled' });
    expect(readdirSync(join(root, 'companies', c.id, 'transcriptions'))).toEqual([]);
  });

  it('stops a client’s jobs, and waits for their working files to go, before the client is deleted', async () => {
    const c = await client();
    process.env.FAKE_ENGINE_STEP_MS = '300';
    const started = await jobs.start(c.id, 'se_1', [c.fileId]);
    await until(
      () => jobs.get(c.id, started.id),
      (j) => j.state === 'transcribing',
    );
    await jobs.stopCompany(c.id);
    expect(jobs.get(c.id, started.id).state).toBe('cancelled');
    expect(readdirSync(join(root, 'companies', c.id, 'transcriptions'))).toEqual([]);
  });
});
