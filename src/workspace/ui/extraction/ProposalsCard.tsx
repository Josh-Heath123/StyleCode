import { useCallback, useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Icon } from '../../../ui/Icon';
import { canUseAi } from '../../model/consent';
import { isPending } from '../../model/findings';
import { KIND_LABEL, STATUS_LABEL } from '../../model/labels';
import { notesOf } from '../../model/notes';
import { acceptReviewed, rejectReviewed } from '../../model/record';
import { segmentsOf, speakerOf, transcriptOf } from '../../model/transcripts';
import { FINDING_STATUSES, type CompanyWorkspace, type Finding, type FindingStatus, type Session } from '../../model/types';
import { get } from '../../model/util';
import { formatDuration } from '../../extraction/estimate';
import { DROP_LABELS, DROP_REASONS, sessionPassages, type DropCounts } from '../../extraction/proposals';
import { reviewReport } from '../../extraction/report';
import { passageTokens } from '../../extraction/run';
import { formatTimeOfDay } from '../../time';
import type { ClientView } from '../ClientFrame';
import { count } from '../chrome';
import { FindingFields, speakerName, type FindingDraft } from '../FindingForm';
import { FormDialog, NameField, nameFor } from '../fields';
import { now, step } from '../steps';
import { useConsultant } from '../useConsultant';
import { currentAiSetup, type AiSetup } from './aiSetup';
import { coverageOf } from './coverage';
import {
  discardRun,
  dismissRun,
  estimateFor,
  isRunning,
  partsText,
  remainingMs,
  startRun,
  stopRun,
  useRun,
  type Run,
} from './runs';

/** Where the AI runs, in a few words. */
export function whereItRuns(setup: AiSetup): string {
  return setup.processing.kind === 'local'
    ? `${setup.model}, on this computer`
    : `${setup.model}, by ${setup.processing.provider}`;
}

/**
 * What the checks kept out, as sentences: the proposals that failed them
 * (invented or unreadable evidence, a kind or status that isn't allowed), and
 * the repeats, which aren't failures.
 */
export function droppedText(dropped: DropCounts): { failed: string | null; leftOut: string | null } {
  const failed = DROP_REASONS.filter((r) => r !== 'repeat' && dropped[r] > 0).map((r) => `${dropped[r]} ${DROP_LABELS[r]}`);
  return {
    failed: failed.length ? `Not shown, because they failed StyleCode’s checks: ${failed.join('; ')}.` : null,
    leftOut: dropped.repeat ? `Left out: ${dropped.repeat} ${DROP_LABELS.repeat}.` : null,
  };
}

/**
 * The AI's proposals still waiting for review from a session, in the order
 * of what they quote: the transcript first, then the notes.
 */
export function pendingProposals(ws: CompanyWorkspace, sessionId: string): Finding[] {
  const transcript = transcriptOf(ws, sessionId);
  const order = new Map<string, number>();
  (transcript ? segmentsOf(ws, transcript.id) : []).forEach((s, i) => order.set(s.id, i));
  notesOf(ws, sessionId).forEach((n, i) => order.set(n.id, 1_000_000 + i));
  const position = (f: Finding) =>
    Math.min(
      ...f.evidence.map((e) =>
        e.kind === 'segment'
          ? (order.get(e.segmentId) ?? Infinity)
          : e.kind === 'note'
            ? (order.get(e.noteId) ?? Infinity)
            : Infinity,
      ),
    );
  return Object.values(ws.findings)
    .filter((f) => isPending(f) && f.origin.kind === 'ai' && f.origin.inputSessionIds.includes(sessionId))
    .sort((a, b) => position(a) - position(b) || a.createdAt.localeCompare(b.createdAt));
}

/** The passages a proposal quotes, with the words quoted from each: what the transcript and notes highlight. */
export function quotedPassages(finding: Finding | undefined): Map<string, string[]> {
  const quoted = new Map<string, string[]>();
  for (const e of finding?.evidence ?? []) {
    if (e.kind === 'deleted') continue;
    const id = e.kind === 'segment' ? e.segmentId : e.noteId;
    quoted.set(id, [...(quoted.get(id) ?? []), e.quote]);
  }
  return quoted;
}

/**
 * The AI on a session (MVP 6.1–6.3; Phase 2 brief, WP6 and WP7): asking it
 * for findings, the run while it goes (wherever the consultant is in
 * StyleCode), and its proposals waiting for review, each accepted, edited
 * and accepted, or rejected as one undoable step, from the keyboard too.
 * Selecting a proposal highlights what it quotes in the transcript and notes.
 */
export function ProposalsCard({
  view,
  meeting,
  selected,
  onSelect,
}: {
  view: ClientView;
  meeting: Session;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const { workspace, readOnly } = view;
  const proposals = pendingProposals(workspace, meeting.id);
  const report = reviewReport(workspace, meeting.id);
  const run = useRun(view.session.companyId, meeting.id);
  if (readOnly && !proposals.length && !report.total.proposed) return null;
  return (
    <section className="ws-card ws-proposals-card" aria-labelledby="ai-findings-title">
      <h2 id="ai-findings-title">Findings from the AI</h2>
      {!readOnly && <RunPanel view={view} meeting={meeting} run={run} />}
      <ProposalList view={view} meeting={meeting} proposals={proposals} selected={selected} onSelect={onSelect} />
      {report.total.proposed > 0 && <ReviewReport report={report} />}
    </section>
  );
}

// Asking, the run, and what it gave
// ---------------------------------------------------------------------------

function RunPanel({ view, meeting, run }: { view: ClientView; meeting: Session; run: Run | undefined }) {
  const { workspace, session } = view;
  const [setup, setSetup] = useState<AiSetup | string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, tick] = useState(0);
  const running = isRunning(run);

  const refresh = useCallback(() => {
    void currentAiSetup().then(setSetup);
  }, []);
  // The settings may change in the editor at any time: read them again when the page comes back into view.
  useEffect(() => {
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [refresh]);
  // What the card offers after a run follows the settings as they are then.
  useEffect(() => {
    if (!running) refresh();
  }, [running, refresh]);
  // The time left, kept current while the run goes.
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => tick((n) => n + 1), 15_000);
    return () => window.clearInterval(timer);
  }, [running]);

  const passages = sessionPassages(workspace, meeting.id);
  const allowed = setup && typeof setup !== 'string' ? canUseAi(workspace, meeting.id, setup.processing) : null;
  const why =
    passages.length === 0
      ? 'Import a transcript or write notes first: the AI proposes findings from them.'
      : typeof setup === 'string'
        ? setup
        : allowed && !allowed.ok
          ? `The AI isn’t offered for this session. ${allowed.error}`
          : null;
  const ready = !why && setup && typeof setup !== 'string' ? setup : null;
  const estimate = ready ? estimateFor(ready, passageTokens(passages)) : null;
  const summary = run && !running ? run : null;

  const ask = async () => {
    setError(null);
    const start = await currentAiSetup();
    setSetup(start);
    if (typeof start === 'string') return setError(start);
    if (run) dismissRun(run);
    setError(startRun(session, meeting, start, location.hash));
  };
  const askButton = ready && (
    <button type="button" className="button primary" onClick={() => void ask()}>
      <Icon name="sparkle" size={14} /> {summary ? 'Ask the AI again' : 'Ask the AI for findings'}
    </button>
  );

  return (
    <>
      {!running && !summary && (
        <div className="ws-run">
          {why && <p className="ws-muted">{why}</p>}
          {ready && (
            <>
              <p className="ws-help">
                The AI reads this session’s transcript and notes, and nothing else, using {whereItRuns(ready)}. What it proposes
                waits for your review and isn’t part of the record until you accept it. It usually finds about two thirds of what
                a careful consultant would record, so read the transcript too.
              </p>
              <p className="ws-help" data-testid="run-estimate">
                {estimate !== null
                  ? `This will take ${formatDuration(estimate)}, judging by ${ready.model}’s earlier runs on this computer. You can keep working meanwhile.`
                  : `No estimate yet: ${ready.model} hasn’t read a whole session on this computer before. A local model can take several minutes for a long meeting, and you can keep working meanwhile.`}
              </p>
              <div className="ws-run-actions">{askButton}</div>
            </>
          )}
        </div>
      )}
      {/* What the run is doing or did, and what an unfinished run read: kept in sight at the top of the column. */}
      <div className="ws-run-status">
        {run && running && <Progress run={run} />}
        {summary && <Summary run={summary} why={why} askButton={askButton} />}
        <CoverageNotice view={view} meeting={meeting} />
        {error && (
          <p className="ws-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </>
  );
}

function Progress({ run }: { run: Run }) {
  const left = remainingMs(run);
  return (
    <div className="ws-row is-static ws-run-progress">
      <p className="ws-row-main" role="status">
        {run.parts > 1 ? `The AI is reading part ${run.part} of ${run.parts}.` : 'The AI is reading the session.'}{' '}
        {left !== null ? `${capital(formatDuration(left))} left.` : ''} You can leave this page: it keeps going while StyleCode is
        open.
      </p>
      <button type="button" className="button" onClick={() => stopRun(run.companyId, run.sessionId)}>
        Stop
      </button>
    </div>
  );
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function Summary({ run, why, askButton }: { run: Run; why: string | null; askButton: ReactNode }) {
  const added = run.addedIds.length;
  const { failed, leftOut } = run.dropped ? droppedText(run.dropped) : { failed: null, leftOut: null };
  return (
    <div className="ws-run-summary" role="status">
      {run.state === 'failed' && (
        <p className="ws-error">
          {run.parts > 1 && run.part > 0 ? `The AI stopped working on part ${run.part} of ${run.parts}. ` : ''}
          {run.error}
        </p>
      )}
      {run.state === 'stopped' && <p>{run.partsDone ? `Stopped after ${partsText(run.partsDone, run.parts)}.` : 'Stopped.'}</p>}
      {run.state === 'finished' && (
        <p>{added ? `The AI proposed ${count(added, 'finding')} to review.` : 'The AI proposed nothing new.'}</p>
      )}
      {run.state !== 'finished' && run.partsDone === 0 && <p>Nothing was added: no part had finished.</p>}
      {run.state !== 'finished' && run.partsDone > 0 && !added && (
        <p>Nothing new came from {partsText(run.partsDone, run.parts)}.</p>
      )}
      {run.unreadable > 0 && (
        <p>
          {run.unreadable === run.partsDone && run.partsDone === 1
            ? 'Its reply'
            : `Its reply to ${count(run.unreadable, 'part')}`}{' '}
          couldn’t be read, so try again or choose another model.
        </p>
      )}
      {failed && <p className="ws-help">{failed}</p>}
      {leftOut && <p className="ws-help">{leftOut}</p>}
      {why && <p className="ws-muted">{why}</p>}
      <div className="ws-run-actions">
        {askButton}
        <button type="button" className="button" onClick={() => dismissRun(run)}>
          Close this summary
        </button>
      </div>
    </div>
  );
}

/**
 * What a run that didn't finish read, until its proposals are all reviewed or
 * discarded, after a reload too (`coverage.ts`), with the way to discard them.
 */
function CoverageNotice({ view, meeting }: { view: ClientView; meeting: Session }) {
  const [note, setNote] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const coverage = coverageOf(view.session.companyId, meeting.id);
  const waiting = coverage
    ? Object.values(view.workspace.findings).filter(
        (f) =>
          isPending(f) && f.origin.kind === 'ai' && f.origin.at === coverage.at && f.origin.inputSessionIds.includes(meeting.id),
      )
    : [];
  // Once they are back (undo), the note that they were discarded no longer holds.
  useEffect(() => {
    if (waiting.length && note) setNote(null);
  }, [waiting.length, note]);
  if (!coverage || (!waiting.length && !note)) return null;
  const parts = partsText(coverage.partsDone, coverage.parts);
  if (!waiting.length) return <p role="status">{note}</p>;
  return (
    <div className="ws-run-coverage">
      <p>
        {count(waiting.length, 'proposal')} from {parts} {waiting.length === 1 ? 'is' : 'are'} waiting for review. The rest of the
        session wasn’t read: ask the AI again to read all of it.
      </p>
      {problem && (
        <p className="ws-error" role="alert">
          {problem}
        </p>
      )}
      {!view.readOnly && (
        <div className="ws-run-actions">
          <button
            type="button"
            className="button"
            onClick={() => {
              const problem = discardRun(
                view.session,
                waiting.map((f) => f.id),
              );
              setProblem(problem);
              if (!problem) setNote(`The proposals from ${parts} were discarded. Undo brings them back.`);
            }}
          >
            Discard {waiting.length === 1 ? 'this proposal' : `these ${waiting.length} proposals`}
          </button>
        </div>
      )}
    </div>
  );
}

// Reviewing
// ---------------------------------------------------------------------------

const NO_NAME = 'Give your name in Settings first: accepting or rejecting records who did it.';

function ProposalList({
  view,
  meeting,
  proposals,
  selected,
  onSelect,
}: {
  view: ClientView;
  meeting: Session;
  proposals: Finding[];
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const { session, readOnly } = view;
  const consultant = useConsultant();
  const [statusFor, setStatusFor] = useState<Record<string, FindingStatus>>({});
  const [editing, setEditing] = useState<Finding | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!proposals.length) return null;

  const current = proposals.find((p) => p.id === selected) ?? null;
  const focus = (id: string | null) => {
    onSelect(id);
    if (id) requestAnimationFrame(() => document.getElementById(`proposal-${id}`)?.focus());
  };
  /** After one is accepted or rejected, the next takes its place. */
  const after = (id: string) => {
    const i = proposals.findIndex((p) => p.id === id);
    return proposals[i + 1]?.id ?? proposals[i - 1]?.id ?? null;
  };
  const review = async (f: Finding, how: 'accept' | 'reject') => {
    const by = await consultant.current();
    if (!by) return setError(NO_NAME);
    const status = statusFor[f.id] ?? f.status;
    const problem =
      how === 'accept'
        ? step(session, 'Accept a proposal', (ws) => acceptReviewed(ws, f.id, { status }, by, now()))
        : step(session, 'Reject a proposal', (ws) => rejectReviewed(ws, f.id, by, now()));
    setError(problem);
    if (!problem) focus(after(f.id));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLOListElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if ((e.target as HTMLElement).closest('select, input, textarea')) return;
    const i = proposals.findIndex((p) => p.id === current?.id);
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (key === 'ArrowDown' || key === 'j') focus(proposals[Math.min(proposals.length - 1, i + 1)].id);
    else if (key === 'ArrowUp' || key === 'k') focus(proposals[Math.max(0, i - 1)].id);
    else if (key === 'Home') focus(proposals[0].id);
    else if (key === 'End') focus(proposals[proposals.length - 1].id);
    else if (current && !readOnly && key === 'a') void review(current, 'accept');
    else if (current && !readOnly && key === 'r') void review(current, 'reject');
    else if (current && !readOnly && key === 'e') setEditing(current);
    else return;
    e.preventDefault();
  };

  return (
    <>
      <div className="ws-proposals-head">
        <h3 id="proposals-title">{count(proposals.length, 'proposal')} waiting for review</h3>
        {!readOnly && (
          <p className="ws-help">
            Select one to see what it quotes. Keys: <kbd>↑</kbd> <kbd>↓</kbd> to move, <kbd>A</kbd> accept, <kbd>E</kbd> edit,{' '}
            <kbd>R</kbd> reject, <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo.
          </p>
        )}
      </div>
      {error && (
        <p className="ws-error" role="alert">
          {error}
          {error === NO_NAME && (
            <>
              {' '}
              <a href="#/settings">Open Settings</a>
            </>
          )}
        </p>
      )}
      <ol className="ws-proposals" aria-labelledby="proposals-title" onKeyDown={onKeyDown}>
        {proposals.map((f, i) => (
          <ProposalItem
            key={f.id}
            view={view}
            meeting={meeting}
            finding={f}
            selected={f.id === current?.id}
            tabbable={current ? f.id === current.id : i === 0}
            status={statusFor[f.id] ?? f.status}
            onStatus={(s) => setStatusFor((all) => ({ ...all, [f.id]: s }))}
            onSelect={() => onSelect(f.id)}
            onAccept={() => void review(f, 'accept')}
            onReject={() => void review(f, 'reject')}
            onEdit={() => setEditing(f)}
          />
        ))}
      </ol>
      {editing && (
        <EditDialog
          view={view}
          finding={editing}
          onClose={() => {
            const id = editing.id;
            setEditing(null);
            requestAnimationFrame(() => document.getElementById(`proposal-${id}`)?.focus());
          }}
          onAccepted={() => {
            const next = after(editing.id);
            setEditing(null);
            focus(next);
          }}
        />
      )}
    </>
  );
}

function ProposalItem({
  view,
  meeting,
  finding: f,
  selected,
  tabbable,
  status,
  onStatus,
  onSelect,
  onAccept,
  onReject,
  onEdit,
}: {
  view: ClientView;
  meeting: Session;
  finding: Finding;
  selected: boolean;
  tabbable: boolean;
  status: FindingStatus;
  onStatus: (status: FindingStatus) => void;
  onSelect: () => void;
  onAccept: () => void;
  onReject: () => void;
  onEdit: () => void;
}) {
  const { workspace, readOnly } = view;
  const statementId = `proposal-${f.id}-statement`;
  return (
    <li
      id={`proposal-${f.id}`}
      className={`ws-proposal${selected ? ' is-selected' : ''}`}
      tabIndex={tabbable ? 0 : -1}
      aria-labelledby={statementId}
      aria-current={selected ? 'true' : undefined}
      onFocus={(e) => e.target === e.currentTarget && onSelect()}
      onClick={(e) => !(e.target as HTMLElement).closest('button, select, a') && onSelect()}
    >
      <ul className="ws-evidence ws-proposal-quotes" aria-label="What it quotes">
        {f.evidence.map((e, i) => (
          <li key={i}>
            {e.kind === 'deleted' ? (
              <span className="ws-muted">A quote since deleted</span>
            ) : (
              <>
                <q>{e.quote}</q> <span className="ws-muted">{quoteSource(workspace, meeting, e)}</span>
              </>
            )}
          </li>
        ))}
      </ul>
      <p className="ws-finding-statement" id={statementId}>
        {f.statement}
      </p>
      <div className="ws-labels">
        <span className="ws-badge is-ai">
          <Icon name="sparkle" size={12} /> Proposed by the AI
        </span>
        <span className="ws-badge">{KIND_LABEL[f.kind]}</span>
        <span className="ws-badge is-status" data-status={f.status}>
          <span className="visually-hidden">The AI’s status: </span>
          {STATUS_LABEL[f.status]}
        </span>
      </div>
      {!readOnly && selected && (
        <div className="ws-proposal-actions">
          <label className="ws-inline">
            Accept as
            <select
              className="ws-input ws-select"
              value={status}
              aria-label={`Status when accepting “${f.statement}”`}
              onChange={(e) => onStatus(e.target.value as FindingStatus)}
            >
              {FINDING_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                  {s === f.status ? ' (the AI’s)' : ''}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="button primary" aria-keyshortcuts="A" onClick={onAccept}>
            Accept
          </button>
          <button type="button" className="button" aria-keyshortcuts="E" onClick={onEdit}>
            Edit…
          </button>
          <button type="button" className="button" aria-keyshortcuts="R" onClick={onReject}>
            Reject
          </button>
        </div>
      )}
    </li>
  );
}

/** Who said a quoted passage, or which note it is. */
function quoteSource(ws: CompanyWorkspace, meeting: Session, e: Exclude<Finding['evidence'][number], { kind: 'deleted' }>) {
  if (e.kind === 'note') {
    const note = get(ws.notes, e.noteId);
    return `your note${note ? ` at ${formatTimeOfDay(note.writtenAt)}` : ''}`;
  }
  const label = get(ws.segments, e.segmentId)?.speakerLabel;
  if (!label) return 'said';
  // The consultant's side isn't the client: a quote from them says so.
  const side = speakerOf(ws, meeting.id, label)?.side;
  return `said by ${speakerName(ws, meeting.id, label)}${side === 'consultant' ? ' (your side)' : ''}`;
}

/** Edits a proposal and accepts it in one step (MVP 6.2): every change is in its history; what the AI proposed is kept. */
function EditDialog({
  view,
  finding,
  onClose,
  onAccepted,
}: {
  view: ClientView;
  finding: Finding;
  onClose: () => void;
  onAccepted: () => void;
}) {
  const ws = view.workspace;
  const consultant = useConsultant();
  const [draft, setDraft] = useState<FindingDraft>({
    kind: finding.kind,
    statement: finding.statement,
    status: finding.status,
    evidence: finding.evidence,
  });
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const sessions = Object.values(ws.sessions)
    .filter((s) => s.engagementId === finding.engagementId)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return (
    <FormDialog
      title="Edit the proposal, then accept it"
      submitLabel="Accept with these changes"
      error={error}
      onClose={onClose}
      onSubmit={async () => {
        const by = await nameFor(consultant, name);
        if (!by) return setError('Give your name: accepting records who accepted it.');
        const problem = step(view.session, 'Accept a proposal with changes', (w) =>
          acceptReviewed(w, finding.id, draft, by, now()),
        );
        if (problem) return setError(problem);
        onAccepted();
      }}
    >
      <FindingFields
        ws={ws}
        sessions={sessions}
        draft={draft}
        onChange={setDraft}
        statusHelp={`The AI proposed “${STATUS_LABEL[finding.status]}”. Only you can confirm a finding.`}
      />
      <NameField consultant={consultant} value={name} onChange={setName} />
    </FormDialog>
  );
}

// The evaluation report
// ---------------------------------------------------------------------------

function ReviewReport({ report }: { report: ReturnType<typeof reviewReport> }) {
  const rows = [...report.byKind, report.total];
  return (
    <details className="ws-report">
      <summary>How the AI did on this session</summary>
      <p className="ws-help">
        What you did with each of its proposals, by the kind it proposed. Counted on this computer; nothing is sent anywhere.
        “Edited” means you changed its kind, statement or evidence as you accepted it.
      </p>
      <div className="ws-table-wrap" tabIndex={0} role="region" aria-label="The AI’s proposals by kind">
        <table className="ws-table">
          <thead>
            <tr>
              <th scope="col">Kind</th>
              <th scope="col">Proposed</th>
              <th scope="col">Accepted</th>
              <th scope="col">Edited</th>
              <th scope="col">Rejected</th>
              <th scope="col">Waiting</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.kind} className={r.kind === 'all' ? 'is-total' : undefined}>
                <th scope="row">{r.kind === 'all' ? 'All' : KIND_LABEL[r.kind]}</th>
                <td>{r.proposed}</td>
                <td>{r.accepted}</td>
                <td>{r.edited}</td>
                <td>{r.rejected}</td>
                <td>{r.pending}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
