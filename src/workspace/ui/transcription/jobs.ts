import { useSyncExternalStore } from 'react';
import {
  cancelTranscription,
  discardTranscription,
  getTranscription,
  getTranscriptionStatus,
  listTranscriptions,
  startTranscription,
  transcriptionResult,
  WorkspaceApiError,
} from '../../api';
import { canUseAi } from '../../model/consent';
import { addRecordedTranscript } from '../../model/recordings';
import type { Session } from '../../model/types';
import { get } from '../../model/util';
import type { WorkspaceSession } from '../../session';
import { isJobOver, type JobResult, type JobView, type TranscriptionStatus } from '../../transcription/types';
import { currentAiSetup } from '../extraction/aiSetup';
import { startRun } from '../extraction/runs';
import { now, permanentStep } from '../steps';
import { holdCompany } from '../useCompanySession';
import { stopPlaying } from './player';

/**
 * Transcriptions as the page follows them (Phase 3 brief, decisions 17 and
 * 18). A transcription is a job in the local server, so it carries on if the
 * page closes; the page asks how it's doing while one is going.
 *
 * With "Add the transcript when it's ready", the page adds it as soon as the
 * job is done, in the one permanent step that also deletes the recordings
 * when the client was told so (decision 22), and, with "Then ask the AI for
 * findings", starts the AI. Its client is held open meanwhile. A save that
 * fails changes nothing, and is tried again.
 */
export interface Transcribing {
  companyId: string;
  job: JobView;
  /** Chosen at Transcribe, while this page is open. */
  auto: { by: string; thenAi: boolean; href: string } | null;
  /** Adding it automatically: going, done, or why it couldn't. */
  adding: 'no' | 'adding' | 'added' | 'failed';
  /** What happened when adding it or asking the AI, for the consultant to read. */
  message: string | null;
}

/** How often a job going is asked about. */
const ASK_EVERY_MS = 1000;
/** Tries at saving an automatic add, and the waits between them. */
const SAVE_RETRIES_MS = [2000, 5000, 10_000];

const tracked = new Map<string, Transcribing>();
const held = new Map<string, { session: WorkspaceSession; meeting: Session; letGo: () => void }>();
const listeners = new Set<() => void>();
let snapshot: Transcribing[] = [];

function publish(): void {
  snapshot = [...tracked.values()];
  listeners.forEach((l) => l());
}

function set(jobId: string, changes: Partial<Transcribing>): void {
  const t = tracked.get(jobId);
  if (!t) return;
  tracked.set(jobId, { ...t, ...changes });
  publish();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** A session's latest transcription, going or ended, if there is one. */
export function useTranscribing(companyId: string, sessionId: string): Transcribing | null {
  const all = useSyncExternalStore(subscribe, () => snapshot);
  const mine = all.filter((t) => t.companyId === companyId && t.job.sessionId === sessionId);
  return mine.sort((a, b) => b.job.createdAt.localeCompare(a.job.createdAt))[0] ?? null;
}

/** Whether a transcription is going on this computer, as far as this page knows. */
export const anyTranscribing = () => [...tracked.values()].some((t) => !isJobOver(t.job.state));

// ---------------------------------------------------------------------------
// Status: whether Transcribe is offered (Settings and the session say why not)
// ---------------------------------------------------------------------------

let status: TranscriptionStatus | string | null = null;
let asking: Promise<void> | null = null;
const statusListeners = new Set<() => void>();

/** Asks the server again: on opening a page that shows it. */
export function refreshTranscriptionStatus(): Promise<void> {
  asking ??= getTranscriptionStatus()
    .then(
      (s) => void (status = s),
      (e: Error) => void (status = e.message),
    )
    .finally(() => {
      asking = null;
      statusListeners.forEach((l) => l());
    });
  return asking;
}

/** Transcription's status: null while asking, a string if the server couldn't say. */
export function useTranscriptionStatus(): TranscriptionStatus | string | null {
  return useSyncExternalStore(
    (l) => {
      statusListeners.add(l);
      return () => statusListeners.delete(l);
    },
    () => status,
  );
}

// ---------------------------------------------------------------------------
// Following jobs
// ---------------------------------------------------------------------------

let timer: ReturnType<typeof setTimeout> | null = null;

function follow(): void {
  if (timer || !anyTranscribing()) return;
  timer = setTimeout(() => {
    timer = null;
    void ask().finally(follow);
  }, ASK_EVERY_MS);
}

async function ask(): Promise<void> {
  for (const t of [...tracked.values()]) {
    if (isJobOver(t.job.state)) continue;
    try {
      const job = await getTranscription(t.companyId, t.job.id);
      set(job.id, { job });
      if (job.state === 'done') void addWhenReady(job.id);
      else if (isJobOver(job.state)) letGo(job.id);
    } catch (error) {
      // Not reachable just now: asked again in a second.
      if (!(error instanceof WorkspaceApiError) || error.status !== 404) continue;
      // The server restarted, which ends its jobs: what it kept shows on the next list.
      set(t.job.id, {
        job: { ...t.job, state: 'failed', error: 'StyleCode’s local server stopped, so the transcription stopped. Try again.' },
      });
      letGo(t.job.id);
    }
  }
}

function letGo(jobId: string): void {
  held.get(jobId)?.letGo();
  held.delete(jobId);
}

/** Reads a client's transcriptions from the server: on opening a session, and after a reload. */
export async function refreshTranscriptions(companyId: string): Promise<void> {
  let jobs: JobView[];
  try {
    jobs = await listTranscriptions(companyId);
  } catch {
    return;
  }
  for (const job of jobs) {
    const known = tracked.get(job.id);
    tracked.set(job.id, known ? { ...known, job } : { companyId, job, auto: null, adding: 'no', message: null });
  }
  publish();
  follow();
}

/**
 * Starts transcribing a session's recordings, in order. Returns why it
 * couldn't, or null. With `auto`, the transcript is added when it's ready,
 * and the AI may be asked next.
 */
export async function startTranscribing(
  session: WorkspaceSession,
  meeting: Session,
  recordingIds: readonly string[],
  auto: Transcribing['auto'],
): Promise<string | null> {
  let job: JobView;
  try {
    job = await startTranscription(session.companyId, meeting.id, recordingIds);
  } catch (e) {
    return (e as Error).message;
  }
  tracked.set(job.id, { companyId: session.companyId, job, auto, adding: 'no', message: null });
  if (auto) held.set(job.id, { session, meeting, letGo: holdCompany(session) });
  publish();
  follow();
  void refreshTranscriptionStatus();
  return null;
}

/** Stops a transcription; nothing it made is kept. */
export async function cancelTranscribing(t: Transcribing): Promise<string | null> {
  try {
    set(t.job.id, { job: await cancelTranscription(t.companyId, t.job.id) });
    follow();
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

/** Forgets a transcription that ended, discarding a result nobody added. */
export async function discardTranscribing(t: Transcribing): Promise<string | null> {
  try {
    if (t.job.state === 'done' && t.adding !== 'added') await discardTranscription(t.companyId, t.job.id);
  } catch (e) {
    return (e as Error).message;
  }
  letGo(t.job.id);
  tracked.delete(t.job.id);
  publish();
  return null;
}

export const fetchResult = (t: Transcribing): Promise<JobResult> => transcriptionResult(t.companyId, t.job.id);

/**
 * Adds a finished transcription as the session's transcript, in one
 * permanent step (decisions 18 and 22), with the speakers matched in the
 * preview. Consent is checked again by the model. Once saved, the result is
 * discarded from the server. Returns why it couldn't, or null.
 */
export async function addTranscription(
  session: WorkspaceSession,
  sessionId: string,
  result: JobResult,
  matches: Readonly<Record<string, string>>,
  by: string,
): Promise<string | null> {
  try {
    await permanentStep(session, 'Add the transcript', (ws) => {
      const added = addRecordedTranscript(
        ws,
        sessionId,
        {
          recordingIds: result.recordingIds,
          segments: result.segments,
          transcriber: result.transcriber,
          speakers: result.speakers,
          matches,
        },
        by,
        now(),
      );
      return added.ok ? { ok: true, value: added.value.workspace } : added;
    });
  } catch (e) {
    return (e as Error).message;
  }
  // The recordings may be gone now (decision 22): nothing plays them any more.
  stopPlaying(result.recordingIds);
  const t = tracked.get(result.jobId);
  if (t) set(result.jobId, { adding: 'added' });
  await discardTranscription(session.companyId, result.jobId).catch(() => undefined);
  if (t && !t.auto) {
    tracked.delete(result.jobId);
    publish();
  }
  return null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** "Add the transcript when it's ready", then maybe "Then ask the AI for findings" (decision 18). */
async function addWhenReady(jobId: string): Promise<void> {
  const t = tracked.get(jobId);
  const hold = held.get(jobId);
  if (!t?.auto || t.adding !== 'no' || !hold) return letGo(jobId);
  set(jobId, { adding: 'adding' });
  const { session, meeting } = hold;
  let problem: string | null = null;
  try {
    const result = await fetchResult(t);
    for (let attempt = 0; ; attempt++) {
      if (session.closed) {
        problem = 'The client was closed, so the transcript wasn’t added. It is ready to add.';
        break;
      }
      problem = await addTranscription(session, meeting.id, result, {}, t.auto.by);
      // A save that failed changed nothing (decision 22), so it is tried again; a refusal by the model isn't.
      if (!problem || !problem.startsWith('Not saved') || attempt >= SAVE_RETRIES_MS.length) break;
      await sleep(SAVE_RETRIES_MS[attempt]);
    }
  } catch (e) {
    problem = (e as Error).message;
  }
  if (problem) {
    set(jobId, { adding: 'failed', message: `The transcript is ready, but couldn’t be added: ${problem}` });
    return letGo(jobId);
  }
  let message: string | null = null;
  if (t.auto.thenAi) message = await askAi(session, meeting, t.auto.href);
  set(jobId, { message });
  if (!message) {
    tracked.delete(jobId);
    publish();
  }
  letGo(jobId);
}

/** Starts the AI on the session just transcribed, if consent allows it now. Returns why not, or null. */
async function askAi(session: WorkspaceSession, meeting: Session, href: string): Promise<string | null> {
  const setup = await currentAiSetup();
  if (typeof setup === 'string') return `The transcript was added, but the AI wasn’t asked: ${setup}`;
  const ws = session.getState().workspace;
  const current = get(ws.sessions, meeting.id) ?? meeting;
  const allowed = canUseAi(ws, meeting.id, setup.processing, now());
  if (!allowed.ok) return `The transcript was added, but the AI wasn’t asked: ${allowed.error}`;
  const problem = startRun(session, current, setup, href);
  return problem ? `The transcript was added, but the AI wasn’t asked: ${problem}` : null;
}

/** Clears what the consultant has read. A result nobody added stays, ready to review. */
export function dismissTranscribing(t: Transcribing): void {
  if (t.job.state === 'done' && t.adding !== 'added') return set(t.job.id, { message: null, adding: 'no', auto: null });
  if (!isJobOver(t.job.state)) return;
  tracked.delete(t.job.id);
  publish();
}

if (typeof window !== 'undefined')
  window.addEventListener('beforeunload', (e) => {
    // A transcript waiting to be added by this page would wait for the consultant instead.
    if (![...tracked.values()].some((t) => t.auto && (t.adding === 'adding' || !isJobOver(t.job.state)))) return;
    e.preventDefault();
    e.returnValue = '';
  });
