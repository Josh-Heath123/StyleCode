import { useState } from 'react';
import { KIND_LABEL, STATUS_LABEL } from '../model/labels';
import { notesOf } from '../model/notes';
import { segmentsOf, speakerOf, transcriptOf } from '../model/transcripts';
import {
  FINDING_KINDS,
  FINDING_STATUSES,
  type CompanyWorkspace,
  type Evidence,
  type FindingKind,
  type FindingStatus,
  type Session,
} from '../model/types';
import { get } from '../model/util';
import { formatTimeOfDay } from '../time';
import { formatWhen } from './chrome';
import { DialogField } from './fields';

/**
 * The fields of a finding, shared by the record (adding and changing a
 * finding by hand, MVP 6.4 and 7.1) and the review of the AI's proposals
 * (editing one before accepting it, MVP 6.2): statement, kind, status, and
 * quotes from the engagement's notes and transcripts as evidence.
 */
export interface FindingDraft {
  kind: FindingKind;
  statement: string;
  status: FindingStatus;
  evidence: Evidence[];
}

export function FindingFields({
  ws,
  sessions,
  draft,
  onChange,
  statusHelp,
}: {
  ws: CompanyWorkspace;
  /** The engagement's sessions, oldest first: where evidence can come from. */
  sessions: Session[];
  draft: FindingDraft;
  onChange: (update: (draft: FindingDraft) => FindingDraft) => void;
  statusHelp?: string;
}) {
  const { kind, statement, status, evidence } = draft;
  const setEvidence = (update: (list: Evidence[]) => Evidence[]) => onChange((d) => ({ ...d, evidence: update(d.evidence) }));
  const quoteFor = (noteId: string) =>
    evidence.find((e): e is Extract<Evidence, { kind: 'note' }> => e.kind === 'note' && e.noteId === noteId);
  const setQuote = (noteId: string, quote: string | null) =>
    setEvidence((list) => {
      const rest = list.filter((e) => !(e.kind === 'note' && e.noteId === noteId));
      return quote === null ? rest : [...rest, { kind: 'note', noteId, quote }];
    });
  const notes = sessions.flatMap((s) => notesOf(ws, s.id).map((n) => ({ note: n, session: s })));
  return (
    <>
      <DialogField label="Statement">
        {(id) => (
          <textarea
            id={id}
            className="ws-input"
            rows={3}
            value={statement}
            onChange={(e) => {
              const value = e.target.value;
              onChange((d) => ({ ...d, statement: value }));
            }}
          />
        )}
      </DialogField>
      <DialogField label="Kind">
        {(id) => (
          <select
            id={id}
            className="ws-input"
            value={kind}
            onChange={(e) => {
              const value = e.target.value as FindingKind;
              onChange((d) => ({ ...d, kind: value }));
            }}
          >
            {FINDING_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        )}
      </DialogField>
      <fieldset className="ws-field ws-fieldset">
        <legend className="ws-label">Status</legend>
        <div className="ws-choices">
          {FINDING_STATUSES.map((s) => (
            <label key={s} className="ws-choice">
              <input
                type="radio"
                name="finding-status"
                checked={status === s}
                onChange={() => onChange((d) => ({ ...d, status: s }))}
              />
              {STATUS_LABEL[s]}
            </label>
          ))}
        </div>
        {statusHelp && <p className="ws-help">{statusHelp}</p>}
      </fieldset>
      <fieldset className="ws-field ws-fieldset">
        <legend className="ws-label">Evidence from your notes (optional)</legend>
        {notes.length === 0 ? (
          <p className="ws-help">This engagement’s sessions have no notes yet.</p>
        ) : (
          <div className="ws-evidence-pick">
            {notes.map(({ note, session }) => {
              const picked = quoteFor(note.id);
              return (
                <div key={note.id} className="ws-evidence-note">
                  <label className="ws-choice">
                    <input
                      type="checkbox"
                      checked={!!picked}
                      onChange={(e) => setQuote(note.id, e.target.checked ? note.text : null)}
                    />
                    <span>
                      {note.text}{' '}
                      <span className="ws-muted">
                        ({session.title}, {formatTimeOfDay(note.writtenAt)})
                      </span>
                    </span>
                  </label>
                  {picked && (
                    <input
                      className="ws-input"
                      aria-label={`The words quoted from the note “${note.text.slice(0, 40)}”`}
                      value={picked.quote}
                      onChange={(e) => setQuote(note.id, e.target.value)}
                    />
                  )}
                </div>
              );
            })}
            <p className="ws-help">Quote the whole note, or cut it down to at least three of its words, as written.</p>
          </div>
        )}
      </fieldset>
      <TranscriptEvidence ws={ws} sessions={sessions} evidence={evidence} setEvidence={setEvidence} />
    </>
  );
}

/** Who a speaker label is: the matched participant's name, or the label. */
export function speakerName(ws: CompanyWorkspace, sessionId: string | null | undefined, label: string): string {
  return (sessionId && speakerOf(ws, sessionId, label)?.name) || label;
}

export function EvidenceLine({
  workspace,
  evidence: e,
  engagementHref,
}: {
  workspace: CompanyWorkspace;
  evidence: Evidence;
  engagementHref: string;
}) {
  if (e.kind === 'deleted') {
    const s = get(workspace.sessions, e.sessionId);
    return (
      <span className="ws-muted">
        A quote from {s ? s.title : 'a deleted session'}, since deleted ({formatWhen(e.deletedAt)})
      </span>
    );
  }
  const note = e.kind === 'note' ? get(workspace.notes, e.noteId) : undefined;
  const segment = e.kind === 'segment' ? get(workspace.segments, e.segmentId) : undefined;
  const sessionId = note?.sessionId ?? (segment && get(workspace.transcripts, segment.transcriptId)?.sessionId);
  const s = sessionId ? get(workspace.sessions, sessionId) : undefined;
  return (
    <>
      <q>{e.quote}</q>{' '}
      <span className="ws-muted">
        {e.kind === 'note'
          ? `note at ${note ? formatTimeOfDay(note.writtenAt) : '?'}`
          : `said${segment?.speakerLabel ? ` by ${speakerName(workspace, sessionId, segment.speakerLabel)}` : ''}`}
        , in{' '}
      </span>
      {s ? (
        <a href={`${engagementHref}/s/${s.id}/p/${e.kind === 'note' ? e.noteId : e.segmentId}`}>{s.title}</a>
      ) : (
        <span className="ws-muted">a session that is gone</span>
      )}
    </>
  );
}

/**
 * Quotes from the engagement's transcripts (MVP 6.4): find a passage by its
 * words, tick it, and cut the quote down if needed. Quoting one makes the
 * finding "said in a session" (decision 9).
 */
function TranscriptEvidence({
  ws,
  sessions,
  evidence,
  setEvidence,
}: {
  ws: CompanyWorkspace;
  sessions: Session[];
  evidence: Evidence[];
  setEvidence: (update: (list: Evidence[]) => Evidence[]) => void;
}) {
  const [query, setQuery] = useState('');
  const passages = sessions.flatMap((session) => {
    const t = transcriptOf(ws, session.id);
    return t ? segmentsOf(ws, t.id).map((segment) => ({ segment, session })) : [];
  });
  if (!passages.length) return null;
  const quoteFor = (segmentId: string) =>
    evidence.find((e): e is Extract<Evidence, { kind: 'segment' }> => e.kind === 'segment' && e.segmentId === segmentId);
  const setQuote = (segmentId: string, quote: string | null) =>
    setEvidence((list) => {
      const rest = list.filter((e) => !(e.kind === 'segment' && e.segmentId === segmentId));
      return quote === null ? rest : [...rest, { kind: 'segment', segmentId, quote }];
    });
  const words = query.trim().toLocaleLowerCase();
  const found =
    words.length >= 2
      ? passages.filter((p) => !quoteFor(p.segment.id) && p.segment.text.toLocaleLowerCase().includes(words))
      : [];
  const shown = [...passages.filter((p) => quoteFor(p.segment.id)), ...found.slice(0, 12)];
  return (
    <fieldset className="ws-field ws-fieldset">
      <legend className="ws-label">Evidence from the transcripts (optional)</legend>
      <input
        className="ws-input"
        type="search"
        aria-label="Find words in the transcripts"
        placeholder="Find words in the transcripts"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {words.length >= 2 && !found.length && <p className="ws-help">No passage has those words.</p>}
      {found.length > 12 && <p className="ws-help">Showing the first 12 of {found.length}. Add words to narrow it down.</p>}
      {shown.length > 0 && (
        <div className="ws-evidence-pick">
          {shown.map(({ segment, session }) => {
            const picked = quoteFor(segment.id);
            const who = segment.speakerLabel ? speakerName(ws, session.id, segment.speakerLabel) : 'No speaker given';
            return (
              <div key={segment.id} className="ws-evidence-note">
                <label className="ws-choice">
                  <input
                    type="checkbox"
                    checked={!!picked}
                    onChange={(e) => setQuote(segment.id, e.target.checked ? segment.text : null)}
                  />
                  <span>
                    {who}: {segment.text} <span className="ws-muted">({session.title})</span>
                  </span>
                </label>
                {picked && (
                  <input
                    className="ws-input"
                    aria-label={`The words quoted from “${segment.text.slice(0, 40)}”`}
                    value={picked.quote}
                    onChange={(e) => setQuote(segment.id, e.target.value)}
                  />
                )}
              </div>
            );
          })}
          <p className="ws-help">Quote the whole passage, or cut it down to at least three of its words, as said.</p>
        </div>
      )}
    </fieldset>
  );
}
