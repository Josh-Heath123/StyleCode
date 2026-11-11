import { useSyncExternalStore } from 'react';
import { canUseAi } from '../../model/consent';
import { discardProposals } from '../../model/record';
import type { Session } from '../../model/types';
import { ok } from '../../model/util';
import {
  addProposals,
  checkProposals,
  engagementFindings,
  sessionPassages,
  withCurrentPassages,
  type DropCounts,
  type RawProposal,
} from '../../extraction/proposals';
import { extract, passageTokens } from '../../extraction/run';
import type { WorkspaceSession } from '../../session';
import { now, step } from '../steps';
import { holdCompany } from '../useCompanySession';
import { sendForSession, type AiSetup } from './aiSetup';
import { setCoverage } from './coverage';
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
  const elapsed = at - run.startedAt;
  if (run.tokensDone > 0) return Math.max(0, (elapsed / run.tokensDone) * (run.tokensTotal - run.tokensDone));
  return run.estimateMs === null ? null : Math.max(0, run.estimateMs - elapsed);
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
  let ended: Pick<Run, 'state' | 'error'>;
  try {
    const result = await extract({
      title: meeting.title,
      passages,
      contextSize: setup.contextSize,
      send: sendForSession(setup, () => session.getState().workspace, meeting.id),
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
    recordSpeed(setup, Date.now() - (runs.get(key)?.startedAt ?? Date.now()), passageTokens(passages));
  } catch (e) {
    ended = controller.signal.aborted ? { state: 'stopped', error: null } : { state: 'failed', error: (e as Error).message };
  }
  controllers.delete(key);

  let addedIds: string[] = [];
  let dropped: DropCounts | null = null;
  let error = ended.error;
  const at = now();
  if (partsDone > 0) {
    const label =
      ended.state === 'finished' ? 'Add the AI’s proposals' : `Add the AI’s proposals from ${partsText(partsDone, parts)}`;
    const problem = step(session, label, (ws) => {
      const checked = checkProposals(withCurrentPassages(raw, ws), engagementFindings(ws, meeting.id));
      dropped = checked.dropped;
      if (!checked.proposals.length) return ok(ws);
      const stored = addProposals(ws, meeting.id, checked.proposals, {
        provider: setup.provider,
        model: setup.model,
        processing: setup.processing,
        at,
      });
      if (!stored.ok) return stored;
      addedIds = stored.value.ids;
      return ok(stored.value.workspace);
    });
    if (problem) {
      addedIds = [];
      error = `${error ? `${error} ` : ''}The proposals couldn’t be added: ${problem}`;
    }
  }
  // What a run that didn't finish read is kept with its proposals; one that read it all makes that moot.
  if (ended.state === 'finished') setCoverage(session.companyId, meeting.id, null);
  else if (addedIds.length)
    setCoverage(session.companyId, meeting.id, { companyId: session.companyId, sessionId: meeting.id, at, partsDone, parts });
  update(key, { ...ended, error, addedIds, dropped, unreadable, partsDone, parts });
  letGo();
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
