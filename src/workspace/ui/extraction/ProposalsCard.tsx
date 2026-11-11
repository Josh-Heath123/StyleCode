import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../../../ui/Icon';
import { canUseAi } from '../../model/consent';
import { isPending } from '../../model/findings';
import type { Session } from '../../model/types';
import { ok } from '../../model/util';
import {
  addProposals,
  checkProposals,
  DROP_LABELS,
  DROP_REASONS,
  engagementFindings,
  sessionPassages,
  withCurrentPassages,
  type DropCounts,
} from '../../extraction/proposals';
import { extract } from '../../extraction/run';
import type { ClientView } from '../ClientFrame';
import { count } from '../chrome';
import { now, step } from '../steps';
import { currentAiSetup, sendForSession, type AiSetup } from './aiSetup';

/** What the last run gave, shown until the next one. */
interface RunSummary {
  added: number;
  dropped: DropCounts;
  unreadable: number;
  parts: number;
}

/** Where the AI runs, in a few words. */
export function whereItRuns(setup: AiSetup): string {
  return setup.processing.kind === 'local'
    ? `${setup.model}, on this computer`
    : `${setup.model}, by ${setup.processing.provider}`;
}

/** The dropped proposals, as a sentence: "2 quoted words that aren't in the passage; 1 cited nothing". */
export function droppedText(dropped: DropCounts): string | null {
  const parts = DROP_REASONS.filter((r) => dropped[r] > 0).map((r) => `${dropped[r]} ${DROP_LABELS[r]}`);
  return parts.length ? parts.join('; ') : null;
}

/**
 * Asking the AI for findings from a session (MVP 6.1; Phase 2 brief, WP6).
 * The action is offered only when AI is on and the session's consent allows
 * the provider set up, and otherwise the card says why (C5, C6, C7). A run
 * reads the session in parts, can be cancelled, and saves nothing unless it
 * finishes; then its proposals are added in one undoable step.
 */
export function ProposalsCard({ view, meeting }: { view: ClientView; meeting: Session }) {
  const { workspace, readOnly, session } = view;
  const [setup, setSetup] = useState<AiSetup | string | null>(null);
  const [progress, setProgress] = useState<{ part: number; parts: number } | null>(null);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = useRef<AbortController | null>(null);

  const refresh = useCallback(() => {
    void currentAiSetup().then(setSetup);
  }, []);
  // The settings may change in the editor at any time: read them again when the page comes back into view.
  useEffect(() => {
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [refresh]);
  // Leaving the page stops a run; nothing is saved.
  useEffect(() => () => running.current?.abort(), []);

  const passages = sessionPassages(workspace, meeting.id);
  const pending = Object.values(workspace.findings).filter(
    (f) => isPending(f) && f.origin.kind === 'ai' && f.origin.inputSessionIds.includes(meeting.id),
  ).length;
  const allowed = setup && typeof setup !== 'string' ? canUseAi(workspace, meeting.id, setup.processing) : null;
  const why =
    passages.length === 0
      ? 'Import a transcript or write notes first: the AI proposes findings from them.'
      : typeof setup === 'string'
        ? setup
        : allowed && !allowed.ok
          ? `The AI isn’t offered for this session. ${allowed.error}`
          : null;
  if (readOnly && !pending) return null;

  const run = async () => {
    setError(null);
    setSummary(null);
    const start = await currentAiSetup();
    setSetup(start);
    if (typeof start === 'string') return setError(start);
    const consent = canUseAi(session.getState().workspace, meeting.id, start.processing, now());
    if (!consent.ok) return setError(consent.error);
    const controller = new AbortController();
    running.current = controller;
    setProgress({ part: 0, parts: 0 });
    try {
      const result = await extract({
        title: meeting.title,
        passages: sessionPassages(session.getState().workspace, meeting.id),
        contextSize: start.contextSize,
        send: sendForSession(start, () => session.getState().workspace, meeting.id),
        signal: controller.signal,
        onProgress: setProgress,
      });
      let added = 0;
      let dropped: DropCounts | null = null;
      const problem = step(session, 'Add the AI’s proposals', (ws) => {
        const checked = checkProposals(withCurrentPassages(result.raw, ws), engagementFindings(ws, meeting.id));
        dropped = checked.dropped;
        added = checked.proposals.length;
        if (!added) return ok(ws);
        const stored = addProposals(ws, meeting.id, checked.proposals, {
          provider: start.provider,
          model: start.model,
          processing: start.processing,
          at: now(),
        });
        return stored.ok ? ok(stored.value.workspace) : stored;
      });
      if (problem) setError(`${problem} Nothing was saved.`);
      else setSummary({ added, dropped: dropped!, unreadable: result.unreadable, parts: result.parts });
    } catch (e) {
      setError(controller.signal.aborted ? 'Stopped. Nothing was saved.' : `${(e as Error).message} Nothing was saved.`);
    } finally {
      running.current = null;
      setProgress(null);
      // What the card offers next follows the settings as they are now.
      refresh();
    }
  };

  const dropped = summary && droppedText(summary.dropped);
  return (
    <section className="ws-card" aria-labelledby="ai-findings-title">
      <div className="ws-card-head">
        <h2 id="ai-findings-title">Findings from the AI</h2>
        {!readOnly && !why && setup && !progress && (
          <button type="button" className="button primary" onClick={() => void run()}>
            <Icon name="sparkle" size={14} /> Ask the AI for findings
          </button>
        )}
      </div>
      {!readOnly && why && <p className="ws-muted">{why}</p>}
      {!readOnly && !why && setup && typeof setup !== 'string' && !progress && (
        <p className="ws-help">
          The AI reads this session’s transcript and notes, and nothing else, using {whereItRuns(setup)}. What it proposes waits
          for your review and isn’t part of the record until you accept it.
        </p>
      )}
      {progress && (
        <div className="ws-row is-static">
          <p className="ws-row-main" role="status">
            {progress.parts > 1
              ? `The AI is reading part ${progress.part} of ${progress.parts}…`
              : 'The AI is reading the session…'}{' '}
            A local model can take a few minutes.
          </p>
          <button type="button" className="button" onClick={() => running.current?.abort()}>
            Stop
          </button>
        </div>
      )}
      {error && (
        <p className="ws-error" role="alert">
          {error}
        </p>
      )}
      {summary && (
        <div role="status">
          <p>
            {summary.added ? `The AI proposed ${count(summary.added, 'finding')} to review.` : 'The AI proposed nothing new.'}
            {summary.unreadable > 0 &&
              ` ${summary.unreadable === summary.parts ? 'Its reply' : `Its reply to ${count(summary.unreadable, 'part')}`} couldn’t be read, so try again or choose another model.`}
          </p>
          {dropped && <p className="ws-help">Not shown, because they failed StyleCode’s checks: {dropped}.</p>}
        </div>
      )}
      {pending > 0 && <p className="ws-help">{count(pending, 'proposal')} waiting for review.</p>}
    </section>
  );
}
