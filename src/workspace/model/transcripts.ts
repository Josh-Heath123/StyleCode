/**
 * A session's transcript (MVP story 4; Phase 2 brief, decisions 3, 4, 6 and
 * 13): importing it, matching its speakers to participants, replacing it and
 * deleting it. Pure, like the rest of the model.
 *
 * Importing, replacing and deleting are permanent: the app saves each one
 * straight away and clears the undo history, as it does for files, so no undo
 * can bring back a client's words after they were deleted. Matching a
 * speaker is an ordinary undoable step.
 */
import { canCapture, checkSpeakers, consentFor, lockConsent, type SpeakerCheck } from './consent.ts';
import { isInRecord, isPending, removeFindings, removeTranscript, type TranscriptRemoval } from './findings.ts';
import type {
  CompanyWorkspace,
  Evidence,
  Finding,
  Participant,
  Timestamp,
  Transcript,
  TranscriptSegment,
  TranscriptSource,
} from './types.ts';
import { createId, fail, get, isNonEmptyText, ok, type Result } from './util.ts';
import { ID_PREFIX } from './workspace.ts';

/** One segment as a reader gives it: a cue, or a turn where the source has no cues. */
export interface ParsedSegment {
  speakerLabel: string | null;
  /** Milliseconds from the start of the meeting, where the source gives them. */
  startMs: number | null;
  endMs: number | null;
  text: string;
}

/** What is imported: the segments, and where they came from. */
export interface TranscriptInput {
  source: TranscriptSource;
  segments: readonly ParsedSegment[];
}

export interface Imported {
  workspace: CompanyWorkspace;
  transcriptId: string;
  /** The speaker warning kept on the transcript (rule C11). */
  speakers: SpeakerCheck;
  /** Labels matched to a participant on import, because they equal the participant's name. */
  matched: string[];
}

/** The session's transcript, if it has one. */
export function transcriptOf(ws: CompanyWorkspace, sessionId: string): Transcript | null {
  return Object.values(ws.transcripts).find((t) => t.sessionId === sessionId) ?? null;
}

/** A transcript's segments, in order. */
export function segmentsOf(ws: CompanyWorkspace, transcriptId: string): TranscriptSegment[] {
  return Object.values(ws.segments)
    .filter((s) => s.transcriptId === transcriptId)
    .sort((a, b) => a.index - b.index);
}

/** The speaker labels of a session's transcript, each once, in the order they first speak. */
export function speakerLabelsOf(ws: CompanyWorkspace, sessionId: string): string[] {
  const transcript = transcriptOf(ws, sessionId);
  if (!transcript) return [];
  const labels: string[] = [];
  for (const s of segmentsOf(ws, transcript.id))
    if (s.speakerLabel !== null && !labels.includes(s.speakerLabel)) labels.push(s.speakerLabel);
  return labels;
}

/** The participant a speaker label belongs to, if it has been matched. */
export function speakerOf(ws: CompanyWorkspace, sessionId: string, label: string): Participant | null {
  return Object.values(ws.participants).find((p) => p.sessionId === sessionId && p.speakerLabels.includes(label)) ?? null;
}

/** A name the way people read it: spacing and letter case don't count. */
const nameKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');

/**
 * Whether a speaker label is a participant's name. Teams adds " (Guest)" or
 * " (External)" to people outside the organiser's company, usually the
 * client, so a label is also their name without it. Who was asked for
 * consent (C11) doesn't depend on this.
 */
const isNameOf = (name: string, label: string) =>
  nameKey(name) === nameKey(label) || nameKey(name) === nameKey(label).replace(/\s*\((guest|external)\)$/, '');

function segmentIssue(s: ParsedSegment): string | null {
  const time = (v: number | null) => v === null || (Number.isFinite(v) && v >= 0);
  if (!time(s.startMs) || !time(s.endMs)) return 'A segment has a time that isn’t a time from the start of the meeting.';
  if (s.endMs !== null && (s.startMs === null || s.endMs < s.startMs)) return 'A segment ends before it starts.';
  return null;
}

/**
 * Imports a transcript into a session (MVP 4.1 and 4.2). It needs consent to
 * transcription (rule C1) and a session without a transcript (MVP Q10). It:
 * - keeps the segments as given, in order (decision 3);
 * - matches each label equal to exactly one participant's name, if no one has
 *   that label yet (MVP 4.3);
 * - keeps the speakers who weren't asked for consent as a warning (rule C11);
 * - locks the consent record (rule C4).
 */
export function importTranscript(
  ws: CompanyWorkspace,
  sessionId: string,
  input: TranscriptInput,
  importedBy: string,
  at: Timestamp,
): Result<Imported> {
  const allowed = canCapture(ws, sessionId, 'transcript-import', at);
  if (!allowed.ok) return allowed;
  if (!isNonEmptyText(importedBy)) return fail('Give your name in Settings first: a transcript records who imported it.');
  // A blank speaker name is no name.
  const segments = input.segments
    .filter((s) => isNonEmptyText(s.text))
    .map((s) => ({ ...s, speakerLabel: s.speakerLabel?.trim() || null }));
  if (!segments.length) return fail('The transcript has nothing anyone said in it.');
  for (const s of segments) {
    const issue = segmentIssue(s);
    if (issue) return fail(issue);
  }
  const record = consentFor(ws, sessionId);
  const locked = record && lockConsent(record, at);
  if (!locked?.ok) return fail(locked ? locked.error : 'Fill in the consent form for this session first.');

  // Labels that are a participant's name are matched, unless someone already has the label.
  const participants = { ...ws.participants };
  const inSession = () => Object.values(participants).filter((p) => p.sessionId === sessionId);
  const matched: string[] = [];
  for (const label of new Set(segments.map((s) => s.speakerLabel).filter((l): l is string => l !== null))) {
    if (inSession().some((p) => p.speakerLabels.includes(label))) continue;
    const named = inSession().filter((p) => isNameOf(p.name, label));
    if (named.length !== 1) continue;
    participants[named[0].id] = { ...named[0], speakerLabels: [...named[0].speakerLabels, label] };
    matched.push(label);
  }

  const transcriptId = createId(ID_PREFIX.transcripts);
  const withMatches = { ...ws, participants };
  const speakers = checkSpeakers(
    withMatches,
    sessionId,
    segments.map((s) => s.speakerLabel),
  );
  const transcript: Transcript = {
    id: transcriptId,
    sessionId,
    source: input.source,
    importedBy: importedBy.trim(),
    importedAt: at,
    unaskedSpeakers: speakers.unaskedSpeakers,
    unnamedSpeakers: speakers.unnamedSpeakers,
  };
  const added: Record<string, TranscriptSegment> = {};
  segments.forEach((s, index) => {
    const id = createId(ID_PREFIX.segments);
    added[id] = {
      id,
      transcriptId,
      index,
      speakerLabel: s.speakerLabel,
      startMs: s.startMs,
      endMs: s.endMs,
      text: s.text,
      confidence: null,
    };
  });
  return ok({
    workspace: {
      ...withMatches,
      consents: { ...ws.consents, [locked.value.id]: locked.value },
      transcripts: { ...ws.transcripts, [transcriptId]: transcript },
      segments: { ...ws.segments, ...added },
    },
    transcriptId,
    speakers,
    matched,
  });
}

/** Whether evidence quotes one of these segments. */
const citesAny = (evidence: readonly Evidence[], segmentIds: ReadonlySet<string>) =>
  evidence.some((e) => e.kind === 'segment' && segmentIds.has(e.segmentId));

function segmentIdsOf(ws: CompanyWorkspace, transcriptId: string): Set<string> {
  return new Set(segmentsOf(ws, transcriptId).map((s) => s.id));
}

/** Findings in the record that quote the session's transcript: while there are any, it can't be replaced (MVP Q10). */
export function findingsQuotingTranscript(ws: CompanyWorkspace, sessionId: string): Finding[] {
  const transcript = transcriptOf(ws, sessionId);
  if (!transcript) return [];
  const ids = segmentIdsOf(ws, transcript.id);
  return Object.values(ws.findings).filter((f) => isInRecord(f) && citesAny(f.evidence, ids));
}

export interface TranscriptDeletion extends TranscriptRemoval {
  /** AI proposals under review that quoted the transcript, removed with it (decision 6). */
  removedProposalIds: string[];
}

/**
 * Deletes a session's transcript (decision 6; rule C8), for example after the
 * client withdraws consent. Proposals under review that quote it go with it.
 * Every other copy of its words is removed as `removeTranscript` describes,
 * and the result says which findings and company facts keep a statement from
 * the session, so the consultant can review them (decision 11).
 */
export function deleteTranscript(ws: CompanyWorkspace, sessionId: string, at: Timestamp): Result<TranscriptDeletion> {
  const transcript = transcriptOf(ws, sessionId);
  if (!transcript) return fail('This session has no transcript.');
  const ids = segmentIdsOf(ws, transcript.id);
  const proposals = Object.values(ws.findings)
    .filter((f) => isPending(f) && citesAny(f.evidence, ids))
    .map((f) => f.id);
  const removed = removeTranscript(removeFindings(ws, proposals, at), sessionId, at);
  if (!removed.ok) return removed;
  return ok({ ...removed.value, removedProposalIds: proposals });
}

/**
 * Whether a session's transcript can be replaced now (MVP Q10; rule C7): it
 * has one, no finding in the record quotes it, and consent allows importing
 * another. Otherwise, why not, so the action can say so.
 */
export function canReplaceTranscript(ws: CompanyWorkspace, sessionId: string): Result<true> {
  const transcript = transcriptOf(ws, sessionId);
  if (!transcript) return fail('This session has no transcript to replace.');
  const quoting = findingsQuotingTranscript(ws, sessionId).length;
  if (quoting)
    return fail(
      `${quoting === 1 ? 'A finding in the record quotes' : `${quoting} findings in the record quote`} this transcript, so it can’t be replaced. Change their evidence first.`,
    );
  const transcripts = { ...ws.transcripts };
  delete transcripts[transcript.id];
  return canCapture({ ...ws, transcripts }, sessionId, 'transcript-import');
}

/**
 * Replaces a session's transcript with another (MVP Q10; decision 6): only
 * while no finding in the record quotes it. Proposals under review that quote
 * it are removed. The new transcript is imported as `importTranscript` does,
 * and needs consent to transcription now.
 */
export function replaceTranscript(
  ws: CompanyWorkspace,
  sessionId: string,
  input: TranscriptInput,
  importedBy: string,
  at: Timestamp,
): Result<Imported & { removedProposalIds: string[] }> {
  const allowed = canReplaceTranscript(ws, sessionId);
  if (!allowed.ok) return allowed;
  const deleted = deleteTranscript(ws, sessionId, at);
  if (!deleted.ok) return deleted;
  const imported = importTranscript(deleted.value.workspace, sessionId, input, importedBy, at);
  if (!imported.ok) return imported;
  return ok({ ...imported.value, removedProposalIds: deleted.value.removedProposalIds });
}

/**
 * Says which participant a speaker label is (MVP 4.3), or with `null` that it
 * is no one in the list. A label belongs to at most one participant, so it is
 * taken from anyone who had it. This changes only `speakerLabels`, never who
 * was asked for consent, so it is allowed on a locked record (decision 13).
 * The transcript's speaker warning stays as it was when it was imported.
 */
export function matchSpeaker(
  ws: CompanyWorkspace,
  sessionId: string,
  label: string,
  participantId: string | null,
): Result<CompanyWorkspace> {
  if (!get(ws.sessions, sessionId)) return fail('The session does not exist.');
  if (!isNonEmptyText(label)) return fail('A speaker needs a name.');
  const to = participantId === null ? null : get(ws.participants, participantId);
  if (participantId !== null && (!to || to.sessionId !== sessionId)) return fail('That person isn’t in this session.');
  const participants = { ...ws.participants };
  let changed = false;
  for (const p of Object.values(ws.participants)) {
    if (p.sessionId !== sessionId) continue;
    const has = p.speakerLabels.includes(label);
    const should = p.id === participantId;
    if (has === should) continue;
    changed = true;
    participants[p.id] = {
      ...p,
      speakerLabels: should ? [...p.speakerLabels, label] : p.speakerLabels.filter((l) => l !== label),
    };
  }
  return ok(changed ? { ...ws, participants } : ws);
}
