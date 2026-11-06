/**
 * A session's notes (MVP story 5.1). Pure, so each change is one undoable
 * step. Notes work whatever the session's consent says (rule C7): they are
 * the consultant's own, and the AI processes them only if consent allows it.
 *
 * Editing or deleting a note that findings quote (Phase 1 brief, decision 6):
 * the app lists those findings first, and going ahead removes that evidence
 * from them in the same step, recorded in each finding's history, so one
 * undo restores the note and the evidence together.
 */
import { editFinding, isPending } from './findings.ts';
import type { CompanyWorkspace, Evidence, Finding, Note, Timestamp } from './types.ts';
import { createId, fail, get, isNonEmptyText, isTimestamp, ok, quoteAppearsIn, type Result } from './util.ts';
import { ID_PREFIX } from './workspace.ts';

/** Adds a note to a session, written at `writtenAt` (when the consultant started it). */
export function addNote(
  ws: CompanyWorkspace,
  sessionId: string,
  text: string,
  writtenAt: Timestamp,
): Result<{ workspace: CompanyWorkspace; id: string }> {
  if (!get(ws.sessions, sessionId)) return fail('The session does not exist.');
  if (!isNonEmptyText(text)) return fail('A note needs some text.');
  if (!isTimestamp(writtenAt)) return fail('A note needs the time it was written.');
  const id = createId(ID_PREFIX.notes);
  const note: Note = { id, sessionId, text: text.trim(), writtenAt, updatedAt: writtenAt };
  return ok({ workspace: { ...ws, notes: { ...ws.notes, [id]: note } }, id });
}

/** Whether a piece of evidence quotes this note in words that the note's new text (or none, if deleted) no longer has. */
function losesQuote(e: Evidence, noteId: string, text: string | null): boolean {
  return e.kind === 'note' && e.noteId === noteId && (text === null || !quoteAppearsIn(text, e.quote));
}

/**
 * The findings whose evidence would lose a quote if the note's text became
 * `text` (or the note were deleted, with `text` null): the ones to list
 * before going ahead.
 */
export function findingsQuotingNote(ws: CompanyWorkspace, noteId: string, text: string | null = null): Finding[] {
  return Object.values(ws.findings).filter(
    (f) =>
      f.evidence.some((e) => losesQuote(e, noteId, text)) ||
      (f.origin.kind === 'ai' && f.origin.proposed.evidence.some((e) => losesQuote(e, noteId, text))),
  );
}

/**
 * Takes the note's lost quotes out of the findings that use them.
 *
 * - The consultant's own findings: the quote is dropped from the evidence as
 *   an edit by the consultant, so it is in the history (decision 6).
 * - Accepted AI findings: the quote becomes deleted evidence (no words, only
 *   the session) in what the AI proposed, in the history and in the
 *   evidence alike, as when a transcript is deleted, so replaying the
 *   history from the proposal still gives the evidence.
 * - An AI proposal still under review: refused until it is reviewed.
 */
function dropQuotes(
  ws: CompanyWorkspace,
  note: Note,
  text: string | null,
  consultant: string,
  at: Timestamp,
): Result<Record<string, Finding>> {
  const findings = { ...ws.findings };
  const scrub = (list: Evidence[]): Evidence[] =>
    list.map((e) => (losesQuote(e, note.id, text) ? { kind: 'deleted', sessionId: note.sessionId, deletedAt: at } : e));
  for (const f of findingsQuotingNote(ws, note.id, text)) {
    if (isPending(f)) return fail(`An AI proposal quotes this note (“${f.statement}”). Review it first.`);
    if (f.origin.kind === 'ai') {
      findings[f.id] = {
        ...f,
        evidence: scrub(f.evidence),
        origin: { ...f.origin, proposed: { ...f.origin.proposed, evidence: scrub(f.origin.proposed.evidence) } },
        history: f.history.map((c) => (c.field === 'evidence' ? { ...c, from: scrub(c.from), to: scrub(c.to) } : c)),
        updatedAt: at,
      };
      continue;
    }
    const edited = editFinding(f, { evidence: f.evidence.filter((e) => !losesQuote(e, note.id, text)) }, consultant, at);
    if (!edited.ok) return edited;
    findings[f.id] = edited.value;
  }
  return ok(findings);
}

/**
 * Changes a note's text. It keeps the time it was written and records when it
 * was changed. Findings whose quotes are no longer in the text lose them.
 */
export function editNote(
  ws: CompanyWorkspace,
  noteId: string,
  text: string,
  consultant: string,
  at: Timestamp,
): Result<CompanyWorkspace> {
  const note = get(ws.notes, noteId);
  if (!note) return fail('The note does not exist.');
  if (!isNonEmptyText(text)) return fail('A note needs some text. To remove it, delete it.');
  const trimmed = text.trim();
  if (trimmed === note.text) return ok(ws);
  const findings = dropQuotes(ws, note, trimmed, consultant, at);
  if (!findings.ok) return findings;
  return ok({ ...ws, notes: { ...ws.notes, [noteId]: { ...note, text: trimmed, updatedAt: at } }, findings: findings.value });
}

/** Deletes a note (an ordinary undoable step, decision 7). Findings that quote it lose those quotes. */
export function removeNote(ws: CompanyWorkspace, noteId: string, consultant: string, at: Timestamp): Result<CompanyWorkspace> {
  const note = get(ws.notes, noteId);
  if (!note) return fail('The note does not exist.');
  const findings = dropQuotes(ws, note, null, consultant, at);
  if (!findings.ok) return findings;
  const notes = { ...ws.notes };
  delete notes[noteId];
  return ok({ ...ws, notes, findings: findings.value });
}

/** A session's notes, in the order they were written. */
export function notesOf(ws: CompanyWorkspace, sessionId: string): Note[] {
  return Object.values(ws.notes)
    .filter((n) => n.sessionId === sessionId)
    .sort((a, b) => a.writtenAt.localeCompare(b.writtenAt) || a.id.localeCompare(b.id));
}
