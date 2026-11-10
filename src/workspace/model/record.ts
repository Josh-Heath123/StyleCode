/**
 * The engagement's record (MVP stories 6.4, 7.1 and 7.2): findings added by
 * hand, edited, filtered, and linked. Pure, so each change is one undoable
 * step; every edit to a finding is in its history, with who and when.
 */
import { editFinding, isInRecord, provenanceFor, recordGroups, type FindingEdits, type RecordGroups } from './findings.ts';
import {
  type CompanyWorkspace,
  type Evidence,
  type Finding,
  type FindingKind,
  type FindingRelation,
  type FindingStatus,
  type RelationType,
  type Timestamp,
} from './types.ts';
import {
  createId,
  fail,
  get,
  isNonEmptyText,
  isQuoteLongEnough,
  MIN_QUOTE_WORDS,
  ok,
  quoteAppearsIn,
  type Result,
} from './util.ts';
import { ID_PREFIX } from './workspace.ts';

/** The session a piece of evidence comes from, if it can still be found. */
export function evidenceSession(ws: CompanyWorkspace, e: Evidence): string | null {
  if (e.kind === 'deleted') return e.sessionId;
  if (e.kind === 'note') return get(ws.notes, e.noteId)?.sessionId ?? null;
  const segment = get(ws.segments, e.segmentId);
  return (segment && get(ws.transcripts, segment.transcriptId)?.sessionId) ?? null;
}

/** Why this evidence can't be used for a finding of the engagement, or null if it can. */
function evidenceIssue(ws: CompanyWorkspace, engagementId: string, e: Evidence): string | null {
  if (e.kind === 'deleted') return null;
  const passage = e.kind === 'note' ? get(ws.notes, e.noteId) : get(ws.segments, e.segmentId);
  if (!passage) return `The ${e.kind === 'note' ? 'note' : 'passage'} quoted doesn't exist.`;
  const sessionId = evidenceSession(ws, e);
  if (!sessionId || get(ws.sessions, sessionId)?.engagementId !== engagementId)
    return 'Evidence comes from this engagement’s sessions.';
  const what = e.kind === 'note' ? 'note' : 'passage';
  if (!quoteAppearsIn(passage.text, e.quote)) return `A quote must be words that appear in the ${what}, as written.`;
  if (!isQuoteLongEnough(passage.text, e.quote)) return `A quote is at least ${MIN_QUOTE_WORDS} words, or the whole ${what}.`;
  return null;
}

export interface NewFinding {
  kind: FindingKind;
  statement: string;
  status: FindingStatus;
  evidence: Evidence[];
}

/**
 * Adds a finding the consultant entered (MVP 6.4). Its provenance is
 * "entered by the consultant", or "said in a session" when it quotes a
 * transcript segment.
 */
export function createFinding(
  ws: CompanyWorkspace,
  engagementId: string,
  fields: NewFinding,
  consultant: string,
  at: Timestamp,
): Result<{ workspace: CompanyWorkspace; id: string }> {
  if (!get(ws.engagements, engagementId)) return fail('The engagement does not exist.');
  if (!isNonEmptyText(fields.statement)) return fail('A finding needs a statement.');
  if (!isNonEmptyText(consultant)) return fail('Give your name in Settings first: a finding records who added it.');
  for (const e of fields.evidence) {
    const issue = evidenceIssue(ws, engagementId, e);
    if (issue) return fail(issue);
  }
  const id = createId(ID_PREFIX.findings);
  const finding: Finding = {
    id,
    engagementId,
    kind: fields.kind,
    statement: fields.statement.trim(),
    status: fields.status,
    statusSet: { by: { kind: 'consultant', name: consultant.trim() }, at },
    provenance: provenanceFor(
      { provenance: { kind: 'consultant' }, origin: { kind: 'consultant', by: consultant, at } },
      fields.evidence,
    ),
    evidence: fields.evidence,
    origin: { kind: 'consultant', by: consultant.trim(), at },
    history: [],
    createdAt: at,
    updatedAt: at,
  };
  return ok({ workspace: { ...ws, findings: { ...ws.findings, [id]: finding } }, id });
}

/** Changes a finding in the record (MVP 7.1), each change in its history. Nothing changes when nothing differs. */
export function updateFinding(
  ws: CompanyWorkspace,
  findingId: string,
  edits: FindingEdits,
  consultant: string,
  at: Timestamp,
): Result<CompanyWorkspace> {
  const finding = get(ws.findings, findingId);
  if (!finding) return fail('The finding does not exist.');
  if (!isNonEmptyText(consultant)) return fail('Give your name in Settings first: changes record who made them.');
  for (const e of edits.evidence ?? []) {
    const issue = evidenceIssue(ws, finding.engagementId, e);
    if (issue) return fail(issue);
  }
  if (edits.statement !== undefined) edits = { ...edits, statement: edits.statement.trim() };
  const edited = editFinding(finding, edits, consultant.trim(), at);
  if (!edited.ok) return edited;
  if (edited.value.history.length === finding.history.length) return ok(ws);
  return ok({ ...ws, findings: { ...ws.findings, [findingId]: edited.value } });
}

/** The session a finding rests on, for the filter: every session its evidence comes from. */
export function findingSessions(ws: CompanyWorkspace, f: Finding): string[] {
  return [...new Set(f.evidence.map((e) => evidenceSession(ws, e)).filter((s): s is string => s !== null))];
}

/** The record, grouped, filtered by kind and by session (MVP 7.1). */
export function filteredRecord(
  ws: CompanyWorkspace,
  engagementId: string,
  filter: { kind?: FindingKind | null; sessionId?: string | null } = {},
): RecordGroups {
  const keep = (f: Finding) =>
    (!filter.kind || f.kind === filter.kind) && (!filter.sessionId || findingSessions(ws, f).includes(filter.sessionId));
  const groups = recordGroups(ws, engagementId);
  return {
    confirmed: groups.confirmed.filter(keep),
    assumptions: groups.assumptions.filter(keep),
    open: groups.open.filter(keep),
    suggested: groups.suggested.filter(keep),
  };
}

const linkKey = (type: RelationType, a: string, b: string) =>
  type === 'conflicts-with' && b < a ? `${type}\u0000${b}\u0000${a}` : `${type}\u0000${a}\u0000${b}`;

/**
 * Links two findings of one engagement (MVP 7.2): "from influences to".
 * Both must be in the record; a finding isn't linked to itself; the same
 * link isn't made twice ("conflicts with" counts once in either direction).
 */
export function addRelation(
  ws: CompanyWorkspace,
  link: { type: RelationType; fromId: string; toId: string },
  consultant: string,
  at: Timestamp,
): Result<{ workspace: CompanyWorkspace; id: string }> {
  const from = get(ws.findings, link.fromId);
  const to = get(ws.findings, link.toId);
  if (!from || !to) return fail('Choose two findings to link.');
  if (from.id === to.id) return fail('A finding can’t be linked to itself.');
  if (from.engagementId !== to.engagementId) return fail('Links stay within one engagement.');
  if (!isInRecord(from) || !isInRecord(to)) return fail('Only findings in the record can be linked.');
  if (!isNonEmptyText(consultant)) return fail('Give your name in Settings first: a link records who made it.');
  const key = linkKey(link.type, link.fromId, link.toId);
  if (Object.values(ws.relations).some((r) => linkKey(r.type, r.fromId, r.toId) === key))
    return fail('These findings are already linked that way.');
  const id = createId(ID_PREFIX.relations);
  const relation: FindingRelation = { id, ...link, createdBy: consultant.trim(), createdAt: at };
  return ok({ workspace: { ...ws, relations: { ...ws.relations, [id]: relation } }, id });
}

export function removeRelation(ws: CompanyWorkspace, relationId: string): Result<CompanyWorkspace> {
  if (!get(ws.relations, relationId)) return fail('The link does not exist.');
  const relations = { ...ws.relations };
  delete relations[relationId];
  return ok({ ...ws, relations });
}

/** A finding's links, read from its own end, so each can be followed either way. */
export interface LinkView {
  relation: FindingRelation;
  /** True when this finding is the link's source ("influences"); false when it is the target ("influenced by"). */
  outgoing: boolean;
  other: Finding;
}

export function linksOf(ws: CompanyWorkspace, findingId: string): LinkView[] {
  const out: LinkView[] = [];
  for (const r of Object.values(ws.relations)) {
    const otherId = r.fromId === findingId ? r.toId : r.toId === findingId ? r.fromId : null;
    const other = otherId ? get(ws.findings, otherId) : undefined;
    if (other) out.push({ relation: r, outgoing: r.fromId === findingId, other });
  }
  return out.sort(
    (a, b) => a.relation.createdAt.localeCompare(b.relation.createdAt) || a.relation.id.localeCompare(b.relation.id),
  );
}
