/**
 * Findings: review of AI proposals, edits, the engagement's record, and
 * promotion to company knowledge. Every function is pure and returns new
 * values, so the caller can make each one an undoable step.
 */
import {
  TRACKED_FIELDS,
  type CompanyFact,
  type CompanyWorkspace,
  type Evidence,
  type FactQuote,
  type Finding,
  type FindingChange,
  type FindingKind,
  type FindingStatus,
  type Timestamp,
} from './types';
import { fail, get, isNonEmptyText, ok, type Result } from './util';

/** Whether a finding is part of the record: entered by the consultant, or proposed by the AI and accepted. */
export function isInRecord(finding: Finding): boolean {
  const origin = finding.origin as Finding['origin'] | undefined;
  return origin?.kind === 'consultant' || (origin?.kind === 'ai' && origin.review?.state === 'accepted');
}

/** Whether a finding is an AI proposal still waiting for the consultant. */
export function isPending(finding: Finding): boolean {
  return finding.origin.kind === 'ai' && finding.origin.review.state === 'pending';
}

/** What the consultant can change on a finding (MVP 6.2 and 7.1). */
export interface FindingEdits {
  kind?: FindingKind;
  statement?: string;
  status?: FindingStatus;
  evidence?: Evidence[];
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Applies edits, adding one history entry for each field that actually changes. */
function applyEdits(finding: Finding, edits: FindingEdits, consultant: string, at: Timestamp): Result<Finding> {
  if (edits.statement !== undefined && !isNonEmptyText(edits.statement)) return fail('A finding needs a statement.');
  const next: Finding = { ...finding, history: [...finding.history] };
  for (const field of TRACKED_FIELDS) {
    const to = edits[field];
    if (to === undefined || sameValue(to, finding[field])) continue;
    next.history.push({ field, from: finding[field], to, by: consultant, at } as FindingChange);
    (next as unknown as Record<string, unknown>)[field] = to;
    if (field === 'status') next.statusSet = { by: { kind: 'consultant', name: consultant }, at };
  }
  next.updatedAt = at;
  return ok(next);
}

/**
 * Accepts an AI proposal, with any edits the consultant made while reviewing
 * it (MVP 6.2). The consultant chooses the status as they accept, so this is
 * the only way an AI proposal becomes confirmed. What the AI proposed stays in
 * `origin.proposed`, and each edit is in the history.
 */
export function acceptProposal(finding: Finding, consultant: string, at: Timestamp, edits: FindingEdits = {}): Result<Finding> {
  if (!isPending(finding) || finding.origin.kind !== 'ai') return fail('Only a pending AI proposal can be accepted.');
  if (!consultant.trim()) return fail('Accepting needs the consultant’s name.');
  const edited = applyEdits(finding, edits, consultant, at);
  if (!edited.ok) return edited;
  return ok({
    ...edited.value,
    statusSet: { by: { kind: 'consultant', name: consultant }, at },
    origin: { ...finding.origin, review: { state: 'accepted', by: consultant, at } },
  });
}

/** Rejects an AI proposal. It is kept, hidden, so it isn't proposed again (MVP Q11). */
export function rejectProposal(finding: Finding, consultant: string, at: Timestamp): Result<Finding> {
  if (!isPending(finding) || finding.origin.kind !== 'ai') return fail('Only a pending AI proposal can be rejected.');
  if (!consultant.trim()) return fail('Rejecting needs the consultant’s name.');
  return ok({ ...finding, origin: { ...finding.origin, review: { state: 'rejected', by: consultant, at } }, updatedAt: at });
}

/** The consultant changes a finding in the record, recording who and when for each change. */
export function editFinding(finding: Finding, edits: FindingEdits, consultant: string, at: Timestamp): Result<Finding> {
  if (!isInRecord(finding)) return fail('Review the proposal before changing it.');
  if (!consultant.trim()) return fail('Changing a finding needs the consultant’s name.');
  return applyEdits(finding, edits, consultant, at);
}

/** The consultant changes the status of a finding in the record. */
export function setStatus(finding: Finding, status: FindingStatus, consultant: string, at: Timestamp): Result<Finding> {
  return editFinding(finding, { status }, consultant, at);
}

/** The engagement's record, grouped as in MVP Q12, with "suggested" as a fourth group (DOMAIN-MODEL.md). */
export interface RecordGroups {
  /** Status confirmed (and not an open question). */
  confirmed: Finding[];
  /** Status assumption (and not an open question). */
  assumptions: Finding[];
  /** Status unresolved, or kind open question whatever its status. */
  open: Finding[];
  /** Status suggested (and not an open question). */
  suggested: Finding[];
}

export function recordGroups(ws: CompanyWorkspace, engagementId: string): RecordGroups {
  const groups: RecordGroups = { confirmed: [], assumptions: [], open: [], suggested: [] };
  const findings = Object.values(ws.findings)
    .filter((f) => f.engagementId === engagementId && isInRecord(f))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  for (const f of findings) {
    if (f.kind === 'open-question' || f.status === 'unresolved') groups.open.push(f);
    else if (f.status === 'confirmed') groups.confirmed.push(f);
    else if (f.status === 'assumption') groups.assumptions.push(f);
    else groups.suggested.push(f);
  }
  return groups;
}

/**
 * Makes a finding in the record into company knowledge (vision §3). The fact
 * keeps a copy of the finding's statement and quotes, so it outlives the
 * finding, its session and its engagement.
 */
export function promoteToKnowledge(
  ws: CompanyWorkspace,
  findingId: string,
  factId: string,
  consultant: string,
  at: Timestamp,
): Result<CompanyFact> {
  const finding = get(ws.findings, findingId);
  if (!finding) return fail('The finding does not exist.');
  if (!isInRecord(finding)) return fail('Only findings in the record can become company knowledge.');
  if (!consultant.trim()) return fail('Adding company knowledge needs the consultant’s name.');
  const quotes: FactQuote[] = [];
  for (const e of finding.evidence) {
    if (e.kind === 'segment') {
      const segment = get(ws.segments, e.segmentId);
      const transcript = segment && get(ws.transcripts, segment.transcriptId);
      const session = transcript && get(ws.sessions, transcript.sessionId);
      if (session)
        quotes.push({ text: e.quote, sessionId: session.id, sessionTitle: session.title, speakerLabel: segment.speakerLabel });
    } else if (e.kind === 'note') {
      const note = get(ws.notes, e.noteId);
      const session = note && get(ws.sessions, note.sessionId);
      if (session) quotes.push({ text: e.quote, sessionId: session.id, sessionTitle: session.title, speakerLabel: null });
    }
  }
  return ok({
    id: factId,
    statement: finding.statement,
    kind: finding.kind,
    provenance: finding.provenance,
    source: {
      findingId,
      deletedAt: null,
      engagementName: get(ws.engagements, finding.engagementId)?.name ?? '',
      statement: finding.statement,
      quotes,
    },
    createdBy: consultant,
    createdAt: at,
  });
}

/**
 * Removes findings from a workspace, for example when their session or
 * engagement is deleted. Company knowledge promoted from them stays, with its
 * source marked as deleted; links to them go with them.
 */
export function removeFindings(ws: CompanyWorkspace, findingIds: readonly string[], at: Timestamp): CompanyWorkspace {
  const gone = new Set(findingIds);
  const findings = Object.fromEntries(Object.entries(ws.findings).filter(([id]) => !gone.has(id)));
  const relations = Object.fromEntries(Object.entries(ws.relations).filter(([, r]) => !gone.has(r.fromId) && !gone.has(r.toId)));
  const knowledge = Object.fromEntries(
    Object.entries(ws.knowledge).map(([id, fact]) => [
      id,
      fact.source?.findingId && gone.has(fact.source.findingId)
        ? { ...fact, source: { ...fact.source, findingId: null, deletedAt: at } }
        : fact,
    ]),
  );
  return { ...ws, findings, relations, knowledge };
}

/** What deleting a session's transcript did, so the consultant can review what is left (CONSENT.md, rule C8). */
export interface TranscriptRemoval {
  workspace: CompanyWorkspace;
  /** Findings removed because nothing they rested on is left. */
  removedFindingIds: string[];
  /** Findings that rested partly on the transcript and keep their statement. */
  keptFindingIds: string[];
  /** Company facts that keep a statement from the session: their quotes from it were removed, or their source cited it. */
  factIds: string[];
}

/**
 * Deletes a session's transcript and every copy of its words, for example
 * after the client withdraws consent and asks for it to be deleted (CONSENT.md,
 * rule C8, decision 2). Each cited segment becomes deleted evidence, in the
 * finding, in what the AI proposed and in its history, so no quoted words are
 * left. A finding is removed when nothing it rests on is left, or when it was
 * said in a session and no transcript segment is left. Company facts lose
 * their quotes from the session and keep their statement. The consent record
 * stays, with its withdrawal.
 */
export function removeTranscript(ws: CompanyWorkspace, sessionId: string, at: Timestamp): Result<TranscriptRemoval> {
  const transcript = Object.values(ws.transcripts).find((t) => t.sessionId === sessionId);
  if (!transcript) return fail('This session has no transcript.');
  const gone = new Set(
    Object.values(ws.segments)
      .filter((s) => s.transcriptId === transcript.id)
      .map((s) => s.id),
  );
  const cites = (list: Evidence[]) => list.some((e) => e.kind === 'segment' && gone.has(e.segmentId));
  const scrub = (list: Evidence[]): Evidence[] =>
    list.map((e) => (e.kind === 'segment' && gone.has(e.segmentId) ? { kind: 'deleted', sessionId, deletedAt: at } : e));

  const findings: Record<string, Finding> = {};
  const touched: string[] = [];
  const removed: string[] = [];
  for (const [id, f] of Object.entries(ws.findings)) {
    const proposed = f.origin.kind === 'ai' ? f.origin.proposed.evidence : [];
    const inHistory = f.history.some((c) => c.field === 'evidence' && (cites(c.from) || cites(c.to)));
    if (!cites(f.evidence) && !cites(proposed) && !inHistory) {
      findings[id] = f;
      continue;
    }
    touched.push(id);
    const history = f.history
      .map((c) => (c.field === 'evidence' ? { ...c, from: scrub(c.from), to: scrub(c.to) } : c))
      .filter((c) => JSON.stringify(c.from) !== JSON.stringify(c.to));
    const origin =
      f.origin.kind === 'ai'
        ? { ...f.origin, proposed: { ...f.origin.proposed, evidence: scrub(f.origin.proposed.evidence) } }
        : f.origin;
    const evidence = scrub(f.evidence);
    const live = evidence.filter((e) => e.kind !== 'deleted');
    const lostItsBasis =
      (cites(f.evidence) && live.length === 0) ||
      (f.provenance.kind === 'said-in-session' && !live.some((e) => e.kind === 'segment'));
    if (lostItsBasis) removed.push(id);
    findings[id] = { ...f, evidence, origin, history, updatedAt: at };
  }

  const segments = Object.fromEntries(Object.entries(ws.segments).filter(([id]) => !gone.has(id)));
  const transcripts = Object.fromEntries(Object.entries(ws.transcripts).filter(([id]) => id !== transcript.id));
  const factIds: string[] = [];
  const knowledge = Object.fromEntries(
    Object.entries(ws.knowledge).map(([id, fact]) => {
      if (!fact.source) return [id, fact];
      const quotes = fact.source.quotes.filter((q) => q.sessionId !== sessionId);
      const fromHere = quotes.length !== fact.source.quotes.length || touched.includes(fact.source.findingId ?? '');
      if (fromHere) factIds.push(id);
      return [id, quotes.length === fact.source.quotes.length ? fact : { ...fact, source: { ...fact.source, quotes } }];
    }),
  );

  const workspace = removeFindings({ ...ws, transcripts, segments, findings, knowledge }, removed, at);
  return ok({
    workspace,
    removedFindingIds: removed,
    keptFindingIds: touched.filter((id) => !removed.includes(id)),
    factIds,
  });
}
