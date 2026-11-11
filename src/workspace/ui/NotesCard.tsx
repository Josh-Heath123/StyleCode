import { useEffect, useRef, useState } from 'react';
import { isTypingTarget } from '../../canvas/Canvas';
import { Icon } from '../../ui/Icon';
import { getSettings } from '../api';
import { isPending } from '../model/findings';
import { addNote, editNote, findingsQuotingNote, notesOf, removeNote } from '../model/notes';
import type { Finding, Note, Session } from '../model/types';
import { formatTimeOfDay, sinceStart } from '../time';
import type { ClientView } from './ClientFrame';
import { FormDialog } from './fields';
import { Quoted } from './Quoted';
import { now, step } from './steps';
import { noteDraft, setNoteDraft } from './useCompanySession';

/**
 * A session's notes (MVP story 5.1): written while the meeting happens,
 * without the mouse. N starts a note, Ctrl+Enter adds it and starts the
 * next. Each note keeps when it was written (when typing started), shown as
 * a time of day and as the time into the session.
 */
export function NotesCard({
  view,
  meeting,
  passageId = null,
  quoted,
  onShowProposal,
}: {
  view: ClientView;
  meeting: Session;
  passageId?: string | null;
  /** The notes the selected proposal quotes, with the words quoted from each. */
  quoted?: ReadonlyMap<string, readonly string[]>;
  /** Selects a proposal under review: from the message when one quotes a note (decision 14). */
  onShowProposal?: (findingId: string) => void;
}) {
  const { workspace, readOnly, session } = view;
  const notes = notesOf(workspace, meeting.id);
  // A note left unfinished on this session is open again, as it was left.
  const [writing, setWriting] = useState(() => !readOnly && !!noteDraft(session.companyId, meeting.id));
  const [editing, setEditing] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ note: Note; text: string | null; findings: Finding[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** A proposal under review that quotes the note being changed, so the change waits for its review (decision 14). */
  const [blockedBy, setBlockedBy] = useState<Finding | null>(null);
  const consultant = useConsultantName();

  // N starts a new note, from anywhere on the session page except a text field or a dialog.
  useEffect(() => {
    if (readOnly) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'n' || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      if ((e.target as Element | null)?.closest?.('[role="dialog"]')) return;
      e.preventDefault();
      setWriting(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [readOnly]);

  /** Applies an edit or deletion; one whose quotes findings use is confirmed first (decision 6). */
  const change = (note: Note, text: string | null, confirmed = false): boolean => {
    const findings = findingsQuotingNote(workspace, note.id, text);
    const pending = findings.find(isPending);
    setBlockedBy(pending ?? null);
    if (pending) {
      setError(null);
      return false;
    }
    if (findings.length && !confirmed) {
      setConfirm({ note, text, findings });
      return false;
    }
    if (findings.length && !consultant) {
      setError('Give your name in Settings first: it is recorded in the findings that lose this quote.');
      return false;
    }
    const by = consultant ?? '';
    const problem =
      text === null
        ? step(session, 'Delete a note', (ws) => removeNote(ws, note.id, by, now()))
        : step(session, 'Change a note', (ws) => editNote(ws, note.id, text, by, now()));
    setError(problem);
    return !problem;
  };

  return (
    <section className="ws-card" aria-labelledby="notes-title">
      <div className="ws-card-head">
        <h2 id="notes-title">Notes</h2>
        {!readOnly && !writing && (
          <button type="button" className="button primary" aria-keyshortcuts="N" onClick={() => setWriting(true)}>
            <Icon name="plus" size={14} /> New note <kbd>N</kbd>
          </button>
        )}
      </div>
      {error && (
        <p className="ws-error" role="alert">
          {error}
        </p>
      )}
      {blockedBy && (
        <p className="ws-error" role="alert">
          An AI proposal quotes this note (“{blockedBy.statement}”), so it can’t change until the proposal is reviewed.{' '}
          {onShowProposal && (
            <button
              type="button"
              className="ws-link-button"
              onClick={() => {
                const id = blockedBy.id;
                setBlockedBy(null);
                onShowProposal(id);
              }}
            >
              Review the proposal
            </button>
          )}
        </p>
      )}
      {notes.length === 0 && !writing && (
        <div className="ws-empty is-small">
          <p>
            No notes yet.{' '}
            {readOnly
              ? ''
              : 'Press N, or choose New note, to write what you notice as the meeting goes. Notes are kept whatever the client agreed to.'}
          </p>
        </div>
      )}
      {notes.length > 0 && (
        <ol className="ws-notes" aria-label="Notes">
          {notes.map((note) => (
            <li
              key={note.id}
              id={`passage-${note.id}`}
              tabIndex={-1}
              className={`ws-note${note.id === passageId ? ' is-cited' : ''}${quoted?.has(note.id) ? ' is-quoted' : ''}`}
            >
              <div className="ws-note-time">
                <span>{formatTimeOfDay(note.writtenAt)}</span>
                <span className="ws-muted">{sinceStart(meeting.startsAt, note.writtenAt)}</span>
              </div>
              {editing === note.id ? (
                <NoteEditor
                  label="Change the note"
                  initial={note.text}
                  original={note.text}
                  submitLabel="Save"
                  onSubmit={(text) => {
                    if (change(note, text)) setEditing(null);
                  }}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <div className="ws-note-body">
                  <p className="ws-note-text">
                    <Quoted text={note.text} quotes={quoted?.get(note.id)} />
                  </p>
                  {note.updatedAt !== note.writtenAt && <p className="ws-help">Changed {formatTimeOfDay(note.updatedAt)}</p>}
                </div>
              )}
              {!readOnly && editing !== note.id && (
                <div className="ws-note-actions">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Change the note written at ${formatTimeOfDay(note.writtenAt)}`}
                    data-tip="Change"
                    onClick={() => setEditing(note.id)}
                  >
                    <Icon name="pencil" size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Delete the note written at ${formatTimeOfDay(note.writtenAt)}`}
                    data-tip="Delete"
                    data-tip-side="left"
                    onClick={() => change(note, null)}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
      {writing && <NewNote view={view} meeting={meeting} onClose={() => setWriting(false)} />}
      {confirm && (
        <FormDialog
          title={confirm.text === null ? 'Delete a quoted note' : 'Change a quoted note'}
          submitLabel={confirm.text === null ? 'Delete the note' : 'Change the note'}
          error={null}
          onClose={() => setConfirm(null)}
          onSubmit={() => {
            if (change(confirm.note, confirm.text, true)) {
              setConfirm(null);
              setEditing(null);
            }
          }}
        >
          <p className="ws-dialog-text">
            {confirm.findings.length === 1 ? 'This finding quotes' : 'These findings quote'} the note.{' '}
            {confirm.text === null ? 'Deleting it' : 'The change'} takes the quote out of{' '}
            {confirm.findings.length === 1 ? 'it' : 'them'}, and one undo puts both back.
          </p>
          <ul className="ws-told">
            {confirm.findings.map((f) => (
              <li key={f.id}>{f.statement}</li>
            ))}
          </ul>
        </FormDialog>
      )}
    </section>
  );
}

/**
 * The note being written. Its time is when typing started; Ctrl+Enter adds it
 * and starts the next one. Until it is added or closed it is kept for the
 * session, so leaving the page and coming back doesn't lose it.
 */
function NewNote({ view, meeting, onClose }: { view: ClientView; meeting: Session; onClose: () => void }) {
  const companyId = view.session.companyId;
  const [restored] = useState(() => noteDraft(companyId, meeting.id));
  const startedAt = useRef<string | null>(restored?.startedAt ?? null);
  const [key, setKey] = useState(0);
  return (
    <NoteEditor
      key={key}
      label="New note"
      initial={key === 0 ? (restored?.text ?? '') : ''}
      original=""
      submitLabel="Add note"
      hint="Ctrl+Enter adds it and starts the next one."
      onType={(text) => {
        if (text && !startedAt.current) startedAt.current = now();
        if (!text) startedAt.current = null;
        setNoteDraft(companyId, meeting.id, text && startedAt.current ? { text, startedAt: startedAt.current } : null);
      }}
      onSubmit={(text) => {
        const written = startedAt.current ?? now();
        const result = addNote(view.workspace, meeting.id, text, written);
        if (!result.ok) return;
        // Not added (the client was closed): the text stays, so nothing typed is lost.
        if (!view.session.apply('Add a note', () => result.value.workspace)) return;
        setNoteDraft(companyId, meeting.id, null);
        startedAt.current = null;
        setKey((k) => k + 1);
      }}
      onCancel={() => {
        setNoteDraft(companyId, meeting.id, null);
        onClose();
      }}
    />
  );
}

function NoteEditor({
  label,
  initial,
  original,
  submitLabel,
  hint,
  onType,
  onSubmit,
  onCancel,
}: {
  label: string;
  /** The text the box opens with. */
  initial: string;
  /** The note's text before this change: empty for a new note, even one opened again unfinished. */
  original: string;
  submitLabel: string;
  hint?: string;
  onType?: (text: string) => void;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.setSelectionRange(initial.length, initial.length);
  }, [initial]);
  const submit = () => text.trim() && onSubmit(text);
  return (
    <div className="ws-note-editor">
      <textarea
        ref={ref}
        className="ws-input"
        rows={3}
        aria-label={label}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onType?.(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            submit();
          }
          // Escape leaves a note only while it's empty or unchanged, so a stray key can't lose what was typed.
          if (e.key === 'Escape' && (!text.trim() || text === original)) {
            e.preventDefault();
            onCancel();
          }
        }}
      />
      <div className="ws-actions">
        <button type="button" className="button primary" disabled={!text.trim()} onClick={submit}>
          {submitLabel}
        </button>
        <button type="button" className="button" onClick={onCancel}>
          {original ? 'Cancel' : 'Close'}
        </button>
        {hint && <span className="ws-help">{hint}</span>}
      </div>
    </div>
  );
}

/** The consultant's name, recorded in a finding's history when a note it quotes changes. */
function useConsultantName(): string | null {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    getSettings().then(
      (s) => current && setName(s.consultantName),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, []);
  return name;
}
