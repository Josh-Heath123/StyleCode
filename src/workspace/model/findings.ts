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
  type FileRef,
  type Finding,
  type FindingChange,
  type FindingKind,
  type FindingStatus,
  type Provenance,
  type Timestamp,
} from './types.ts';
import { fail, get, isNonEmptyText, ok, time, type Result } from './util.ts';

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

/**
 * A finding's provenance for the evidence it has (Phase 2 brief, decision 9;
 * MVP 6.4). Citing at least one transcript segment makes it "said in a
 * session". Citing none, it is what it was created as: "entered by the
 * consultant", or "AI-suggested" for an AI proposal. Verified and calculated
 * information keep their provenance. The evidence changes in the history
 * explain each change, so provenance has no history of its own.
 */
export function provenanceFor(finding: Pick<Finding, 'provenance' | 'origin'>, evidence: readonly Evidence[]): Provenance {
  const kind = finding.provenance?.kind;
  if (kind === 'verified' || kind === 'calculated') return finding.provenance;
  if (evidence.some((e) => e.kind === 'segment')) return { kind: 'said-in-session' };
  return finding.origin.kind === 'ai' ? { kind: 'ai-suggested' } : { kind: 'consultant' };
}

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
    if (field === 'evidence') next.provenance = provenanceFor(finding, next.evidence);
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
    .sort((a, b) => time(a.createdAt) - time(b.createdAt) || a.id.localeCompare(b.id));
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
  const sessionIds = new Set<string>();
  for (const e of finding.evidence) {
    if (e.kind === 'deleted') sessionIds.add(e.sessionId);
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
      sessionIds: [...new Set([...quotes.map((q) => q.sessionId), ...sessionIds])],
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

/**
 * Deletes a finding from the record (Phase 2 brief, decision 15), as an
 * ordinary undoable step. Its links go with it, and company facts promoted
 * from it stay, marked "source deleted". A proposal still under review is
 * rejected instead, so it isn't proposed again (MVP Q11).
 */
export function removeFinding(ws: CompanyWorkspace, findingId: string, at: Timestamp): Result<CompanyWorkspace> {
  const finding = get(ws.findings, findingId);
  if (!finding) return fail('The finding does not exist.');
  if (!isInRecord(finding)) return fail('Only a finding in the record can be deleted. Reject a proposal instead.');
  return ok(removeFindings(ws, [findingId], at));
}

/**
 * What removing a transcript, a session or an engagement did, so the
 * consultant can be shown what goes and review what is left.
 */
export interface Removal {
  workspace: CompanyWorkspace;
  /** Findings removed: nothing they rested on is left, or their engagement went. */
  removedFindingIds: string[];
  /** Findings that rested partly on what was removed and keep their statement. */
  keptFindingIds: string[];
  /**
   * Company facts affected. After a transcript is deleted: facts that keep a
   * statement from the session (their quotes from it were removed, or their
   * source cited it). After a session or an engagement is deleted: facts
   * whose source finding was removed, now marked "source deleted".
   */
  factIds: string[];
  /** File entries removed with the session or engagement (their bytes are deleted when the save is written). */
  removedFileIds: string[];
}

/** What deleting a session's transcript did (CONSENT.md, rule C8). */
export type TranscriptRemoval = Omit<Removal, 'removedFileIds'>;

/**
 * Removes passages of one session (transcript segments and notes) from every
 * finding. Each cited passage becomes deleted evidence, in the finding, in
 * what the AI proposed and in its history, so none of its words are left. A
 * finding is removed when nothing it rested on is left. One that keeps other
 * evidence stays, and its provenance follows what is left (decision 9): no
 * transcript segment left means it is no longer "said in a session".
 */
function scrubPassages(
  ws: CompanyWorkspace,
  sessionId: string,
  gone: ReadonlySet<string>,
  at: Timestamp,
): { workspace: CompanyWorkspace; touched: string[]; removed: string[] } {
  const isGone = (e: Evidence) => (e.kind === 'segment' && gone.has(e.segmentId)) || (e.kind === 'note' && gone.has(e.noteId));
  const cites = (list: Evidence[]) => list.some(isGone);
  const scrub = (list: Evidence[]): Evidence[] =>
    list.map((e) => (isGone(e) ? { kind: 'deleted', sessionId, deletedAt: at } : e));

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
    if (cites(f.evidence) && live.length === 0) removed.push(id);
    findings[id] = { ...f, evidence, provenance: provenanceFor(f, evidence), origin, history, updatedAt: at };
  }
  return { workspace: { ...ws, findings }, touched, removed };
}

const without = <T>(map: Record<string, T>, drop: (value: T, id: string) => boolean): Record<string, T> =>
  Object.fromEntries(Object.entries(map).filter(([id, value]) => !drop(value, id)));

/**
 * Deletes a session's transcript and every copy of its words, for example
 * after the client withdraws consent and asks for it to be deleted (CONSENT.md,
 * rule C8, decision 2). Cited segments become deleted evidence, as
 * `scrubPassages` describes. Company facts lose their quotes from the session
 * and keep their statement. The consent record stays, with its withdrawal.
 */
export function removeTranscript(ws: CompanyWorkspace, sessionId: string, at: Timestamp): Result<TranscriptRemoval> {
  const transcript = Object.values(ws.transcripts).find((t) => t.sessionId === sessionId);
  if (!transcript) return fail('This session has no transcript.');
  const gone = new Set(
    Object.values(ws.segments)
      .filter((s) => s.transcriptId === transcript.id)
      .map((s) => s.id),
  );
  const scrubbed = scrubPassages(ws, sessionId, gone, at);
  const factIds: string[] = [];
  const knowledge = Object.fromEntries(
    Object.entries(ws.knowledge).map(([id, fact]) => {
      if (!fact.source) return [id, fact];
      const quotes = fact.source.quotes.filter((q) => q.sessionId !== sessionId);
      const fromHere = quotes.length !== fact.source.quotes.length || scrubbed.touched.includes(fact.source.findingId ?? '');
      if (fromHere) factIds.push(id);
      return [id, quotes.length === fact.source.quotes.length ? fact : { ...fact, source: { ...fact.source, quotes } }];
    }),
  );
  const workspace = removeFindings(
    {
      ...scrubbed.workspace,
      transcripts: without(ws.transcripts, (t) => t.id === transcript.id),
      segments: without(ws.segments, (_, id) => gone.has(id)),
      knowledge,
    },
    scrubbed.removed,
    at,
  );
  return ok({
    workspace,
    removedFindingIds: scrubbed.removed,
    keptFindingIds: scrubbed.touched.filter((id) => !scrubbed.removed.includes(id)),
    factIds,
  });
}

/** Facts whose source finding is among `findingIds` and still linked. */
const factsFrom = (ws: CompanyWorkspace, findingIds: readonly string[]) =>
  Object.values(ws.knowledge)
    .filter((f) => f.source?.findingId != null && findingIds.includes(f.source.findingId))
    .map((f) => f.id);

/**
 * Deletes a session (MVP 2.3; DOMAIN-MODEL.md, decision 4): its participants,
 * consent record, transcript, segments, notes and files. Findings whose only
 * evidence is in the session go with it; a finding with evidence from other
 * sessions too keeps that, and the session's passages become deleted evidence
 * (`scrubPassages`), so no copy of its words is left in a finding. Company
 * facts promoted from a removed finding stay, marked "source deleted", with
 * their copied quotes.
 */
export function removeSession(ws: CompanyWorkspace, sessionId: string, at: Timestamp): Result<Removal> {
  if (!get(ws.sessions, sessionId)) return fail('The session does not exist.');
  const transcriptIds = new Set(
    Object.values(ws.transcripts)
      .filter((t) => t.sessionId === sessionId)
      .map((t) => t.id),
  );
  const segmentIds = Object.values(ws.segments)
    .filter((s) => transcriptIds.has(s.transcriptId))
    .map((s) => s.id);
  const noteIds = Object.values(ws.notes)
    .filter((n) => n.sessionId === sessionId)
    .map((n) => n.id);
  const scrubbed = scrubPassages(ws, sessionId, new Set([...segmentIds, ...noteIds]), at);
  const factIds = factsFrom(ws, scrubbed.removed);
  const ownsFile = (f: FileRef) => f.owner.kind === 'session' && f.owner.sessionId === sessionId;
  const removedFileIds = Object.values(ws.files)
    .filter(ownsFile)
    .map((f) => f.id);
  const workspace = removeFindings(
    {
      ...scrubbed.workspace,
      sessions: without(ws.sessions, (_, id) => id === sessionId),
      participants: without(ws.participants, (p) => p.sessionId === sessionId),
      consents: without(ws.consents, (c) => c.sessionId === sessionId),
      transcripts: without(ws.transcripts, (_, id) => transcriptIds.has(id)),
      segments: without(ws.segments, (s) => transcriptIds.has(s.transcriptId)),
      notes: without(ws.notes, (n) => n.sessionId === sessionId),
      files: without(ws.files, ownsFile),
    },
    scrubbed.removed,
    at,
  );
  return ok({
    workspace,
    removedFindingIds: scrubbed.removed,
    keptFindingIds: scrubbed.touched.filter((id) => !scrubbed.removed.includes(id)),
    factIds,
    removedFileIds,
  });
}

/**
 * Deletes an engagement and everything in it: its findings and their links,
 * its sessions (as `removeSession` does), its design links and its files.
 * Company facts promoted from its findings stay, marked "source deleted"
 * (decision 4).
 */
export function removeEngagement(ws: CompanyWorkspace, engagementId: string, at: Timestamp): Result<Removal> {
  if (!get(ws.engagements, engagementId)) return fail('The engagement does not exist.');
  const findingIds = Object.values(ws.findings)
    .filter((f) => f.engagementId === engagementId)
    .map((f) => f.id);
  const factIds = factsFrom(ws, findingIds);
  let next = removeFindings(ws, findingIds, at);
  const removedFileIds: string[] = [];
  for (const session of Object.values(ws.sessions)) {
    if (session.engagementId !== engagementId) continue;
    const removal = removeSession(next, session.id, at);
    if (!removal.ok) return removal;
    next = removal.value.workspace;
    removedFileIds.push(...removal.value.removedFileIds);
  }
  const ownsFile = (f: FileRef) => f.owner.kind === 'engagement' && f.owner.engagementId === engagementId;
  removedFileIds.push(
    ...Object.values(next.files)
      .filter(ownsFile)
      .map((f) => f.id),
  );
  const workspace: CompanyWorkspace = {
    ...next,
    engagements: without(next.engagements, (_, id) => id === engagementId),
    designs: without(next.designs, (d) => d.engagementId === engagementId),
    files: without(next.files, ownsFile),
  };
  return ok({ workspace, removedFindingIds: findingIds, keptFindingIds: [], factIds, removedFileIds });
}

/**
 * Findings in the record and company facts that keep a statement from a
 * session (rule C8; Phase 2 brief, decision 11): findings with evidence from
 * it, including passages since deleted, and facts that quote it or were
 * promoted from one of those findings. After a withdrawal, the consultant
 * reviews them, to remove any the client asks to have removed.
 */
export function keptFromSession(ws: CompanyWorkspace, sessionId: string): { findings: Finding[]; facts: CompanyFact[] } {
  const transcriptIds = new Set(
    Object.values(ws.transcripts)
      .filter((t) => t.sessionId === sessionId)
      .map((t) => t.id),
  );
  const fromSession = (e: Evidence) =>
    e.kind === 'deleted'
      ? e.sessionId === sessionId
      : e.kind === 'note'
        ? get(ws.notes, e.noteId)?.sessionId === sessionId
        : transcriptIds.has(get(ws.segments, e.segmentId)?.transcriptId ?? '');
  const findings = Object.values(ws.findings).filter((f) => isInRecord(f) && f.evidence.some(fromSession));
  const ids = new Set(findings.map((f) => f.id));
  const facts = Object.values(ws.knowledge).filter(
    (fact) => fact.source && (fact.source.sessionIds.includes(sessionId) || ids.has(fact.source.findingId ?? '')),
  );
  return { findings, facts };
}

/** Removes a company fact (Phase 2 brief, WP8 and decision 11), as an ordinary undoable step. */
export function removeFact(ws: CompanyWorkspace, factId: string): Result<CompanyWorkspace> {
  if (!get(ws.knowledge, factId)) return fail('The company fact does not exist.');
  const knowledge = { ...ws.knowledge };
  delete knowledge[factId];
  return ok({ ...ws, knowledge });
}
