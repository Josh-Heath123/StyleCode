/**
 * From the AI's replies to pending proposals (MVP 6.1; Phase 2 brief,
 * "Clarifications" and decision 7): read each reply, merge the parts, check
 * every proposal, drop what fails with a count for each reason, and store the
 * rest as pending findings. Pure: the caller makes storing one undoable step.
 */
import { canUseAi } from '../model/consent.ts';
import { provenanceFor } from '../model/findings.ts';
import { segmentsOf, speakerOf, transcriptOf } from '../model/transcripts.ts';
import {
  FINDING_KINDS,
  type AiProcessing,
  type CompanyWorkspace,
  type Evidence,
  type Finding,
  type FindingKind,
  type FindingStatus,
  type Timestamp,
} from '../model/types.ts';
import { createId, fail, get, isQuoteLongEnough, ok, quoteAppearsIn, time, type Result } from '../model/util.ts';
import { ID_PREFIX } from '../model/workspace.ts';
import { AI_STATUSES, type Passage } from './prompt.ts';

/**
 * The passages of a session the AI may be given: its transcript's segments
 * (S1, S2…) and its notes (N1, N2…), oldest first. Whether consent allows
 * sending them is checked by the caller with `canUseAi` (rule C5); the notes
 * follow the same consent as the transcript (MVP Q15).
 */
export function sessionPassages(ws: CompanyWorkspace, sessionId: string): Passage[] {
  const passages: Passage[] = [];
  const transcript = transcriptOf(ws, sessionId);
  if (transcript) {
    for (const s of segmentsOf(ws, transcript.id)) {
      const person = s.speakerLabel ? speakerOf(ws, sessionId, s.speakerLabel) : null;
      const speaker = person ? `${person.name} (${person.side === 'consultant' ? 'consultant' : 'client'})` : s.speakerLabel;
      passages.push({ ref: `S${passages.length + 1}`, kind: 'segment', id: s.id, speaker, text: s.text });
    }
  }
  const notes = Object.values(ws.notes)
    .filter((n) => n.sessionId === sessionId && n.text.trim())
    .sort((a, b) => time(a.writtenAt) - time(b.writtenAt) || a.id.localeCompare(b.id));
  notes.forEach((n, i) => passages.push({ ref: `N${i + 1}`, kind: 'note', id: n.id, speaker: null, text: n.text }));
  return passages;
}

/**
 * The proposals with each cited passage as it is in the workspace now, so
 * one deleted or changed while the AI was working fails the checks instead
 * of reaching the record.
 */
export function withCurrentPassages(raw: readonly RawProposal[], ws: CompanyWorkspace): RawProposal[] {
  const now = (p: Passage | null): Passage | null => {
    if (!p) return null;
    const current = p.kind === 'segment' ? get(ws.segments, p.id) : get(ws.notes, p.id);
    return current ? { ...p, text: current.text } : null;
  };
  return raw.map((r) => ({ ...r, evidence: r.evidence.map((e) => ({ ...e, passage: now(e.passage) })) }));
}

/** A proposal as read from a reply: nothing about it is trusted yet. */
export interface RawProposal {
  kind: unknown;
  status: unknown;
  statement: unknown;
  /** Each citation, with the passage it names if that exists. */
  evidence: { ref: string; passage: Passage | null; quote: unknown }[];
}

/** The JSON object in a reply, tolerating code fences or text around it. */
function extractJson(raw: string): unknown {
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return undefined;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return undefined;
    }
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The proposals in one reply, or null if it isn't the JSON asked for. */
export function readReply(reply: string, passages: readonly Passage[]): RawProposal[] | null {
  const json = extractJson(reply);
  const list = isRecord(json) ? json.findings : Array.isArray(json) ? json : undefined;
  if (!Array.isArray(list)) return null;
  const byRef = new Map(passages.map((p) => [p.ref.toUpperCase(), p]));
  return list.filter(isRecord).map((f) => ({
    kind: f.kind,
    status: f.status,
    statement: f.statement,
    evidence: (Array.isArray(f.evidence) ? f.evidence : []).filter(isRecord).map((e) => {
      const ref = String(e.ref ?? '')
        .trim()
        .replace(/^\[|\]$/g, '')
        .toUpperCase();
      return { ref, passage: byRef.get(ref) ?? null, quote: e.quote };
    }),
  }));
}

/** Why a proposal was dropped before the consultant saw it (Phase 2 brief, "Clarifications"). */
export const DROP_REASONS = [
  'unknown-passage',
  'quote-not-found',
  'quote-too-short',
  'no-evidence',
  'no-statement',
  'bad-kind',
  'bad-status',
  'repeat',
] as const;
export type DropReason = (typeof DROP_REASONS)[number];

/** How each reason is shown, after a count: "2 cited a passage that isn't in this session". */
export const DROP_LABELS: Record<DropReason, string> = {
  'unknown-passage': 'cited a passage that isn’t in this session',
  'quote-not-found': 'quoted words that aren’t in the passage',
  'quote-too-short': 'quoted fewer than three words',
  'no-evidence': 'cited nothing',
  'no-statement': 'had no statement',
  'bad-kind': 'had a kind StyleCode doesn’t use',
  'bad-status': 'had a status the AI may not give',
  repeat: 'repeated a finding already in this engagement or proposed again',
};

export type DropCounts = Record<DropReason, number>;

export const noneDropped = (): DropCounts => Object.fromEntries(DROP_REASONS.map((r) => [r, 0])) as DropCounts;

/** A proposal that passed every check, ready to store. */
export interface CheckedProposal {
  kind: FindingKind;
  status: FindingStatus;
  statement: string;
  evidence: Evidence[];
}

/** Ignoring case, spacing and punctuation (decision 7). */
export function normaliseStatement(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const citedIds = (evidence: readonly Evidence[]) =>
  evidence
    .map((e) => (e.kind === 'segment' ? `s:${e.segmentId}` : e.kind === 'note' ? `n:${e.noteId}` : `d:${e.sessionId}`))
    .sort()
    .join('|');

/** Two findings repeat each other: the same kind, and the same statement or the same evidence (decision 7). */
function repeats(a: { kind: string; statement: string; evidence: readonly Evidence[] }, b: typeof a): boolean {
  if (a.kind !== b.kind) return false;
  return normaliseStatement(a.statement) === normaliseStatement(b.statement) || citedIds(a.evidence) === citedIds(b.evidence);
}

/**
 * Checks proposals before any is shown (MVP 6.1). A proposal is dropped if
 * it cites a passage the AI wasn't given, quotes words that aren't in the
 * passage or too few of them, has a kind or status that isn't allowed, or
 * repeats a finding of the engagement (in the record, under review or
 * rejected) or an earlier proposal. Each dropped proposal is counted by its
 * first problem.
 */
export function checkProposals(
  raw: readonly RawProposal[],
  existing: readonly Pick<Finding, 'kind' | 'statement' | 'evidence'>[],
): { proposals: CheckedProposal[]; dropped: DropCounts } {
  const dropped = noneDropped();
  const proposals: CheckedProposal[] = [];
  for (const unchecked of raw) {
    const p: RawProposal = {
      ...unchecked,
      evidence: unchecked.evidence.map((e) => (typeof e.quote === 'string' ? { ...e, quote: withoutEndEllipsis(e.quote) } : e)),
    };
    const reason = problemOf(p);
    if (reason) {
      dropped[reason]++;
      continue;
    }
    const checked: CheckedProposal = {
      kind: p.kind as FindingKind,
      status: p.status as FindingStatus,
      statement: (p.statement as string).trim(),
      evidence: dedupeEvidence(
        p.evidence.map(({ passage, quote }) =>
          passage!.kind === 'segment'
            ? { kind: 'segment', segmentId: passage!.id, quote: (quote as string).trim() }
            : { kind: 'note', noteId: passage!.id, quote: (quote as string).trim() },
        ),
      ),
    };
    if ([...existing, ...proposals].some((f) => repeats(checked, f))) {
      dropped.repeat++;
      continue;
    }
    proposals.push(checked);
  }
  return { proposals, dropped };
}

/**
 * A quote without one "…" or "..." at its start and one at its end, with the
 * space beside it: models mark a quote that starts or stops mid-sentence that
 * way, and the words left must still appear in the passage. An ellipsis inside
 * a quote stays, so it fails the check: it could join words from different
 * places.
 */
export function withoutEndEllipsis(quote: string): string {
  return quote
    .trim()
    .replace(/^(?:…|\.\.\.)\s*/, '')
    .replace(/\s*(?:…|\.\.\.)$/, '');
}

function problemOf(p: RawProposal): DropReason | null {
  if (!FINDING_KINDS.includes(p.kind as FindingKind)) return 'bad-kind';
  if (!(AI_STATUSES as readonly unknown[]).includes(p.status)) return 'bad-status';
  if (typeof p.statement !== 'string' || !p.statement.trim()) return 'no-statement';
  if (!p.evidence.length) return 'no-evidence';
  for (const e of p.evidence) if (!e.passage) return 'unknown-passage';
  for (const e of p.evidence)
    if (typeof e.quote !== 'string' || !quoteAppearsIn(e.passage!.text, e.quote)) return 'quote-not-found';
  for (const e of p.evidence) if (!isQuoteLongEnough(e.passage!.text, e.quote as string)) return 'quote-too-short';
  return null;
}

/** The same passage quoted twice with the same words is one piece of evidence. */
function dedupeEvidence(evidence: Evidence[]): Evidence[] {
  const seen = new Set<string>();
  return evidence.filter((e) => {
    const key = JSON.stringify(e);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The findings of a session's engagement that a new proposal must not repeat: every one, whatever its state. */
export function engagementFindings(ws: CompanyWorkspace, sessionId: string): Finding[] {
  const engagementId = get(ws.sessions, sessionId)?.engagementId;
  return Object.values(ws.findings).filter((f) => f.engagementId === engagementId);
}

/** Who ran the AI, and where (rules C5 and C6). */
export interface ExtractionRun {
  /** The provider kind, such as "ollama". */
  provider: string;
  model: string;
  processing: AiProcessing;
  at: Timestamp;
}

/**
 * Stores checked proposals as pending findings of the session's engagement:
 * the AI's proposal kept unchanged in `origin.proposed`, the session as the
 * only input (decision 7). Refused if consent doesn't allow this processing
 * at this time (rule C5), so nothing reaches the record that consent didn't
 * cover, even if it changed during the run.
 */
export function addProposals(
  ws: CompanyWorkspace,
  sessionId: string,
  proposals: readonly CheckedProposal[],
  run: ExtractionRun,
): Result<{ workspace: CompanyWorkspace; ids: string[] }> {
  const session = get(ws.sessions, sessionId);
  if (!session) return fail('The session does not exist.');
  const allowed = canUseAi(ws, sessionId, run.processing, run.at);
  if (!allowed.ok) return allowed;
  const findings = { ...ws.findings };
  const ids: string[] = [];
  for (const p of proposals) {
    const id = createId(ID_PREFIX.findings);
    const origin: Finding['origin'] = {
      kind: 'ai',
      provider: run.provider,
      model: run.model,
      processing: run.processing,
      inputSessionIds: [sessionId],
      at: run.at,
      proposed: { kind: p.kind, statement: p.statement, status: p.status, evidence: p.evidence },
      review: { state: 'pending' },
    };
    findings[id] = {
      id,
      engagementId: session.engagementId,
      kind: p.kind,
      statement: p.statement,
      status: p.status,
      statusSet: { by: { kind: 'ai', provider: run.provider, model: run.model }, at: run.at },
      provenance: provenanceFor({ provenance: { kind: 'ai-suggested' }, origin }, p.evidence),
      evidence: p.evidence,
      origin,
      history: [],
      createdAt: run.at,
      updatedAt: run.at,
    };
    ids.push(id);
  }
  return ok({ workspace: { ...ws, findings }, ids });
}
