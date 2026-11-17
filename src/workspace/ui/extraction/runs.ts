import { useSyncExternalStore } from 'react';
import { canUseAi } from '../../model/consent';
import { discardProposals } from '../../model/record';
import type { Session } from '../../model/types';
import { fail, get, ok } from '../../model/util';
import { clearAiStop, noteAiStop } from '../../model/aiStop';
import {
  addProposals,
  checkProposals,
  engagementFindings,
  sessionPassages,
  withCurrentPassages,
  type DropCounts,
  type RawProposal,
} from '../../extraction/proposals';
import { extract, passageTokens, type SendPart } from '../../extraction/run';
import type { WorkspaceSession } from '../../session';
import { now, step } from '../steps';
import { holdCompany, onCompanyClosed, reopenHeld } from '../useCompanySession';
import { sendForSession, type AiSetup } from './aiSetup';
import { takeTurn } from './heavySlot';
import type { HeavyKind } from '../../transcription/types';
import { coolDown } from '../../transcription/cooling';
import { getTranscriptionStatus } from '../../api';
import { addCoverage, clearCoverage } from './coverage';
import { recordSpeed, speedOf } from './speed';

/**
 * The AI's runs on sessions, kept outside any page (Phase 2, WP7): a run
 * goes on while the consultant moves around StyleCode, its client is held
 * open meanwhile, and closing the browser tab asks first. However a run
 * ends, what the parts that finished proposed is added in one undoable step:
 * all of it when the run finished, or the parts before a stop or a failure,
 * which the consultant can then discard.
 */
export interface Run {
  companyId: string;
  sessionId: string;
  sessionTitle: string;
  /** The session page. */
  href: string;
  setup: AiSetup;
  state: 'running' | 'finished' | 'stopped' | 'failed';
  /** Waiting for a heavy job on this computer to finish first (decision 10): a transcription, or another AI run. */
  waiting: HeavyKind | null;
  /** Letting the graphics card cool before the next part (decision 10): its temperature. */
  coolingC: number | null;
  /** When the current wait to cool began, and how long the earlier ones took: not reading, so not counted as such. */
  coolingSince: number | null;
  coolingMs: number;
  /** The consultant chose not to wait for the card to cool, for the rest of this run. */
  noCooling: boolean;
  /** The part being read, from 1 (0 before the first starts). */
  part: number;
  parts: number;
  partsDone: number;
  startedAt: number;
  /** How long the whole run was expected to take, from earlier runs of the model here, or null. */
  estimateMs: number | null;
  tokensTotal: number;
  tokensDone: number;
  /** Once it has ended: the proposals added, those dropped by the checks, and parts whose reply couldn't be read. */
  addedIds: string[];
  dropped: DropCounts | null;
  unreadable: number;
  /** Stopped by a deletion or by consent: what the finished parts proposed was not added. */
  discarded: boolean;
  /** Why it failed, or why its proposals couldn't be added. */
  error: string | null;
}

const runs = new Map<string, Run>();
const controllers = new Map<string, AbortController>();
const listeners = new Set<() => void>();
let snapshot: Run[] = [];

const keyOf = (companyId: string, sessionId: string) => `${companyId}/${sessionId}`;

function update(key: string, changes: Partial<Run>): void {
  const run = runs.get(key);
  if (!run) return;
  runs.set(key, { ...run, ...changes });
  publish();
}

function publish(): void {
  snapshot = [...runs.values()];
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Every run, going or ended. */
export function useRuns(): Run[] {
  return useSyncExternalStore(subscribe, () => snapshot);
}

/** A session's run, going or ended, if it had one since the page was loaded. */
export function useRun(companyId: string, sessionId: string): Run | undefined {
  const all = useRuns();
  return all.find((r) => r.companyId === companyId && r.sessionId === sessionId);
}

export const isRunning = (run: Run | undefined) => run?.state === 'running';

/** Whether the AI is working on any session, so closing the tab would lose that run. */
export const anyRunning = () => [...runs.values()].some(isRunning);

if (typeof window !== 'undefined')
  window.addEventListener('beforeunload', (e) => {
    if (!anyRunning()) return;
    e.preventDefault();
    e.returnValue = '';
  });

/** "part 3 of 7", "parts 1 to 4 of 7". */
export function partsText(done: number, parts: number): string {
  return done === 1 ? `part 1 of ${parts}` : `parts 1 to ${done} of ${parts}`;
}

/** How long is likely left, in milliseconds, or null without an estimate. */
export function remainingMs(run: Run, at = Date.now()): number | null {
  const elapsed = readingMs(run, at);
  if (run.tokensDone > 0) return Math.max(0, (elapsed / run.tokensDone) * (run.tokensTotal - run.tokensDone));
  return run.estimateMs === null ? null : Math.max(0, run.estimateMs - elapsed);
}

/** How long the run has spent reading: since it started, less its waits for the graphics card to cool. */
export function readingMs(run: Run, at = Date.now()): number {
  return Math.max(0, at - run.startedAt - run.coolingMs - (run.coolingSince === null ? 0 : at - run.coolingSince));
}

/** How long a run of the session is likely to take with this model, or null before its first full run here. */
export function estimateFor(setup: AiSetup, tokens: number): number | null {
  const speed = speedOf(setup);
  return speed === null ? null : speed * tokens;
}

/**
 * Starts the AI on a session. Returns why it can't start, or null. Consent is
 * checked now, again before each part is sent (`sendForSession`), and again
 * when the proposals are added.
 */
export function startRun(session: WorkspaceSession, meeting: Session, setup: AiSetup, href: string): string | null {
  const key = keyOf(session.companyId, meeting.id);
  if (isRunning(runs.get(key))) return 'The AI is already reading this session.';
  const workspace = () => session.getState().workspace;
  const consent = canUseAi(workspace(), meeting.id, setup.processing, now());
  if (!consent.ok) return consent.error;
  const passages = sessionPassages(workspace(), meeting.id);
  if (!passages.length) return 'Import a transcript or write notes first: the AI proposes findings from them.';

  const tokensTotal = passageTokens(passages);
  const controller = new AbortController();
  controllers.set(key, controller);
  runs.set(key, {
    companyId: session.companyId,
    sessionId: meeting.id,
    sessionTitle: meeting.title,
    href,
    setup,
    state: 'running',
    waiting: null,
    coolingC: null,
    coolingSince: null,
    coolingMs: 0,
    noCooling: false,
    part: 0,
    parts: 0,
    partsDone: 0,
    startedAt: Date.now(),
    estimateMs: estimateFor(setup, tokensTotal),
    tokensTotal,
    tokensDone: 0,
    addedIds: [],
    dropped: null,
    unreadable: 0,
    discarded: false,
    error: null,
  });
  publish();
  void go(key, session, meeting, setup, passages, controller);
  return null;
}

async function go(
  key: string,
  session: WorkspaceSession,
  meeting: Session,
  setup: AiSetup,
  passages: ReturnType<typeof sessionPassages>,
  controller: AbortController,
): Promise<void> {
  const letGo = holdCompany(session);
  const raw: RawProposal[] = [];
  let unreadable = 0;
  let partsDone = 0;
  let parts = 0;
  let ended: Pick<Run, 'state' | 'error'> = { state: 'failed', error: null };
  let addedIds: string[] = [];
  let dropped: DropCounts | null = null;
  let discarded = false;

  // Stops at once, mid-part too, when the client closes (deleted, or reloaded after a conflict), when the
  // session is deleted, or when consent no longer allows this processing (rule C5).
  // A stop by a deletion or by consent keeps nothing; any other keeps what the finished parts proposed.
  let failure: { reason: string; kind: 'deletion' | 'consent' | 'closed' } | null = null;
  const stopWith = (reason: string, kind: 'deletion' | 'consent' | 'closed') => {
    if (failure) return;
    failure = { reason, kind };
    controller.abort();
  };
  const stopOnClose = onCompanyClosed((closed) => {
    if (closed === session) stopWith('The client was closed, so the AI stopped.', 'closed');
  });
  const watch = session.subscribe(() => {
    const ws = session.getState().workspace;
    if (!get(ws.sessions, meeting.id)) return stopWith('The session was deleted, so the AI stopped.', 'deletion');
    const allowed = canUseAi(ws, meeting.id, setup.processing, now());
    if (!allowed.ok) stopWith(`${allowed.error} The AI stopped.`, 'consent');
  });
  const workspace = () => {
    if (session.closed) throw new Error('The client was closed, so the AI stopped.');
    return session.getState().workspace;
  };

  let releaseTurn: () => void = () => undefined;
  try {
    try {
      // A model on this computer takes its turn: a transcription and an AI run never share it (decision 10).
      if (setup.processing.kind === 'local')
        releaseTurn = await takeTurn(controller.signal, (waiting) => update(key, { waiting }));
      // Time spent waiting isn't reading: the time left and this model's speed count from here.
      update(key, { startedAt: Date.now() });
      const result = await extract({
        title: meeting.title,
        passages,
        contextSize: setup.contextSize,
        send: coolFirst(key, setup, sendForSession(setup, workspace, meeting.id)),
        signal: controller.signal,
        onProgress: (p) => {
          parts = p.parts;
          update(key, { part: p.part, parts: p.parts });
        },
        onPart: (done) => {
          raw.push(...done.raw);
          if (!done.readable) unreadable++;
          partsDone = done.part;
          update(key, { partsDone, tokensDone: (runs.get(key)?.tokensDone ?? 0) + done.tokens });
        },
      });
      parts = result.parts;
      ended = { state: 'finished', error: null };
      const done = runs.get(key);
      if (done) recordSpeed(setup, readingMs(done), passageTokens(passages));
    } catch (e) {
      const stoppedBy = failure as { reason: string } | null;
      ended = stoppedBy
        ? { state: 'failed', error: stoppedBy.reason }
        : controller.signal.aborted
          ? { state: 'stopped', error: null }
          : { state: 'failed', error: (e as Error).message };
    }

    const at = now();
    const stop = failure as { kind: string } | null;
    const byDeletionOrConsent = stop?.kind === 'deletion' || stop?.kind === 'consent';
    // A run that failed for any other reason is kept with the session, so it still says so later.
    const unexplained = ended.state === 'failed' && !byDeletionOrConsent;
    discarded = byDeletionOrConsent && partsDone > 0;
    if (!byDeletionOrConsent && (partsDone > 0 || unexplained)) {
      const kept = await keepTo(session);
      if (kept === 'deleted') {
        ended = { state: 'failed', error: 'The client was deleted, so the AI stopped.' };
      } else if (typeof kept === 'string') {
        ended = { ...ended, error: `${ended.error ? `${ended.error} ` : ''}The proposals couldn’t be added: ${kept}` };
      } else {
        try {
          const label =
            partsDone === 0
              ? 'Keep why the AI stopped'
              : ended.state === 'finished'
                ? 'Add the AI’s proposals'
                : `Add the AI’s proposals from ${partsText(partsDone, parts)}`;
          const problem = step(kept.session, label, (ws) => {
            if (!get(ws.sessions, meeting.id)) return fail('The session was deleted.');
            let next = ws;
            if (partsDone > 0) {
              const checked = checkProposals(withCurrentPassages(raw, ws), engagementFindings(ws, meeting.id));
              dropped = checked.dropped;
              if (checked.proposals.length) {
                const stored = addProposals(ws, meeting.id, checked.proposals, {
                  provider: setup.provider,
                  model: setup.model,
                  processing: setup.processing,
                  at,
                });
                if (!stored.ok) return stored;
                addedIds = stored.value.ids;
                next = stored.value.workspace;
              }
            }
            if (unexplained)
              return noteAiStop(next, meeting.id, {
                at,
                reason: ended.error ?? 'The AI stopped for a reason StyleCode wasn’t told.',
                partsDone,
                parts,
                model: setup.model,
              });
            return ended.state === 'finished' ? clearAiStop(next, meeting.id) : ok(next);
          });
          if (problem) {
            addedIds = [];
            ended = { ...ended, error: `${ended.error ? `${ended.error} ` : ''}The proposals couldn’t be added: ${problem}` };
          } else if (kept.session !== session || unexplained) {
            // Saved now: nobody may be at the keyboard, and the next thing to happen could be the laptop stopping.
            await kept.session.saveNow().catch(() => undefined);
          }
        } finally {
          kept.letGo();
        }
      }
    }
    // What a run that didn't finish read is kept with its proposals; one that read it all makes that moot.
    if (ended.state === 'finished' && !ended.error) clearCoverage(session.companyId, meeting.id);
    else if (addedIds.length) addCoverage({ companyId: session.companyId, sessionId: meeting.id, at, partsDone, parts });
  } catch (e) {
    // Never leave a run "running": whatever went wrong is said.
    ended = { state: 'failed', error: `Something went wrong while adding the proposals: ${(e as Error).message}` };
  } finally {
    releaseTurn();
    watch();
    stopOnClose();
    controllers.delete(key);
    update(key, { ...ended, addedIds, dropped, unreadable, partsDone, parts, discarded });
    letGo();
  }
}

/**
 * Before each part on a model on this computer, lets a hot graphics card cool
 * (decision 10, extended after WP8: one long run took the laptop's GPU to
 * 95 °C, and Windows hibernated it). The run says so, and its time left
 * doesn't run down meanwhile. The consultant can choose not to wait.
 */
function coolFirst(key: string, setup: AiSetup, send: SendPart): SendPart {
  if (setup.processing.kind !== 'local') return send;
  return async (request, signal) => {
    await coolDown({
      read: async () => (await getTranscriptionStatus()).temperatureC,
      skip: () => runs.get(key)?.noCooling ?? true,
      signal,
      onCooling: (coolingC) => {
        const run = runs.get(key);
        if (!run) return;
        if (coolingC !== null) return update(key, { coolingC, coolingSince: run.coolingSince ?? Date.now() });
        const waited = run.coolingSince === null ? 0 : Date.now() - run.coolingSince;
        update(key, { coolingC: null, coolingSince: null, coolingMs: run.coolingMs + waited });
      },
    });
    return send(request, signal);
  };
}

/** Starts a run's next part without waiting for the graphics card to cool, and doesn't wait for the rest of the run. */
export function dontWaitToCool(companyId: string, sessionId: string): void {
  update(keyOf(companyId, sessionId), { noCooling: true });
}

/**
 * Where a run's finished parts go: its client as it is open, or opened again
 * from disk if it was closed during the run (reloaded after a conflict, say),
 * held until `letGo`. 'deleted' when the client is gone, or why it couldn't
 * be opened.
 */
async function keepTo(session: WorkspaceSession): Promise<{ session: WorkspaceSession; letGo: () => void } | 'deleted' | string> {
  if (!session.closed) return { session, letGo: () => undefined };
  try {
    return (await reopenHeld(session.companyId)) ?? 'deleted';
  } catch (e) {
    return (e as Error).message;
  }
}

/** Stops a session's run; what the parts that finished proposed is still added. */
export function stopRun(companyId: string, sessionId: string): void {
  controllers.get(keyOf(companyId, sessionId))?.abort();
}

/** Discards what a run that didn't finish proposed, as one undoable step. Returns why it couldn't, or null. */
export function discardRun(session: WorkspaceSession, findingIds: readonly string[]): string | null {
  return step(session, 'Discard the AI’s proposals', (ws) => discardProposals(ws, findingIds));
}

/** Forgets an ended run's summary (the proposals it added stay). */
export function dismissRun(run: Run): void {
  const key = keyOf(run.companyId, run.sessionId);
  if (isRunning(runs.get(key))) return;
  runs.delete(key);
  publish();
}
