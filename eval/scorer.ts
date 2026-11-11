/**
 * Scores an extraction run against a consultation's answer key (Phase 2
 * brief, WP5; old WP7 step 4).
 *
 * 1. Every proposal's evidence is checked: each cited segment must exist and
 *    the quoted words must appear in it. A proposal that fails, or whose kind
 *    or status isn't one the AI may propose, is a failure: it counts against
 *    precision whatever it says, and invented evidence is counted on its own.
 * 2. The rest are matched to the key. A proposal matches a key finding
 *    automatically when they share a cited segment and the proposal's kind is
 *    one the key accepts. Unclear pairs (a shared segment but another kind, or
 *    the same kind and similar words but no shared segment) are listed in a
 *    CSV; a person writes yes or no beside each, and the scorer reads it back.
 *    An unclear pair nobody has settled counts as no match.
 * 3. Precision is the share of proposals that match a key finding; recall is
 *    the share of key findings matched by at least one proposal. Both are
 *    reported per kind. A proposal matching a key finding already matched is a
 *    duplicate: it counts as correct, and the duplicates are reported.
 *
 * Pure: no files, so it is tested like the domain model.
 */
import { FINDING_KINDS, type FindingKind } from '../src/workspace/model/types.ts';
import { isQuoteLongEnough, quoteAppearsIn } from '../src/workspace/model/util.ts';
import type { AnswerKey, EvalTranscript, KeyFinding, RunProposal } from './types.ts';

/** Statuses the AI may propose (decision 8). "confirmed" is the consultant's alone. */
export const AI_STATUSES = ['suggested', 'assumption', 'unresolved'] as const;

export type EvidenceProblem =
  /** No evidence at all. */
  | 'no-evidence'
  /** A cited segment that isn't in the transcript: invented evidence. */
  | 'unknown-segment'
  /** A quote whose words aren't in the segment: invented evidence. */
  | 'quote-not-in-segment'
  /** A quote of one or two words that isn't the whole segment. */
  | 'quote-too-short'
  | 'bad-kind'
  | 'bad-status';

export const INVENTED: readonly EvidenceProblem[] = ['unknown-segment', 'quote-not-in-segment'];

/** What's wrong with a proposal, if anything. */
export function proposalProblems(transcript: EvalTranscript, p: RunProposal): EvidenceProblem[] {
  const problems = new Set<EvidenceProblem>();
  if (!FINDING_KINDS.includes(p.kind as FindingKind)) problems.add('bad-kind');
  if (!(AI_STATUSES as readonly string[]).includes(p.status)) problems.add('bad-status');
  const evidence = Array.isArray(p.evidence) ? p.evidence : [];
  if (!evidence.length) problems.add('no-evidence');
  const byId = new Map(transcript.segments.map((s) => [s.id, s]));
  for (const e of evidence) {
    const segment = byId.get(e?.segmentId);
    if (!segment) problems.add('unknown-segment');
    else if (typeof e.quote !== 'string' || !quoteAppearsIn(segment.text, e.quote)) problems.add('quote-not-in-segment');
    else if (!isQuoteLongEnough(segment.text, e.quote)) problems.add('quote-too-short');
  }
  return [...problems];
}

const words = (text: string) => new Set(text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);

/** How alike two statements are: the share of their words (of three letters or more) they have in common. */
export function similarity(a: string, b: string): number {
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / (x.size + y.size - shared);
}

/** Below this, the same kind without a shared segment isn't worth asking about. */
export const UNCLEAR_SIMILARITY = 0.25;

const acceptedKinds = (k: KeyFinding): string[] => [k.kind, ...(k.alsoAccept ?? [])];

/** A pair a person settles in the CSV. `proposal` is the proposal's position in the run, from 1. */
export interface UnclearPair {
  proposal: number;
  key: string;
  reason: 'other-kind' | 'no-shared-segment';
}

/** Settled pairs, by `${proposal}:${key}`. */
export type Settled = ReadonlyMap<string, boolean>;

export interface ProposalResult {
  proposal: number;
  kind: string;
  problems: EvidenceProblem[];
  /** The key finding it was matched to, or null. */
  matched: string | null;
  how: 'auto' | 'settled' | null;
  duplicate: boolean;
}

export interface KindScore {
  kind: string;
  /** Proposals of this kind. */
  proposed: number;
  /** Of those, how many matched a key finding. */
  correct: number;
  /** Of those, how many cited invented evidence. */
  invented: number;
  /** Key findings of this kind. */
  expected: number;
  /** Of those, how many some proposal matched. */
  found: number;
}

export interface Score {
  consultation: string;
  proposals: ProposalResult[];
  unclear: UnclearPair[];
  /** Unclear pairs nobody has settled yet. */
  unsettled: number;
  missed: string[];
  byKind: KindScore[];
  total: KindScore;
  duplicates: number;
  /** Of the matched proposals, how many proposed the key's status (a key's "confirmed" counts as "suggested"). */
  statusAgrees: number;
  /** Proposals that failed a check StyleCode makes before showing one, so the consultant never sees them. */
  dropped: number;
}

const key = (proposal: number, keyId: string) => `${proposal}:${keyId}`;

export function scoreRun(
  transcript: EvalTranscript,
  answers: AnswerKey,
  proposals: RunProposal[],
  settled: Settled = new Map(),
): Score {
  const unclear: UnclearPair[] = [];
  const results: ProposalResult[] = [];
  const matchedBy = new Map<string, number>();
  let statusAgrees = 0;

  proposals.forEach((p, i) => {
    const n = i + 1;
    const problems = proposalProblems(transcript, p);
    const result: ProposalResult = { proposal: n, kind: String(p.kind), problems, matched: null, how: null, duplicate: false };
    results.push(result);
    if (problems.length) return;

    const cited = new Set(p.evidence.map((e) => e.segmentId));
    const candidates: { finding: KeyFinding; how: 'auto' | 'settled' }[] = [];
    for (const finding of answers.findings) {
      const shares = finding.segments.some((s) => cited.has(s));
      const kindOk = acceptedKinds(finding).includes(p.kind);
      const answer = settled.get(key(n, finding.id));
      if (shares && kindOk) candidates.push({ finding, how: 'auto' });
      else if (shares || (kindOk && similarity(p.statement, finding.statement) >= UNCLEAR_SIMILARITY)) {
        unclear.push({ proposal: n, key: finding.id, reason: shares ? 'other-kind' : 'no-shared-segment' });
        if (answer === true) candidates.push({ finding, how: 'settled' });
      }
    }
    if (!candidates.length) return;
    // A key finding nobody has matched yet first, then the closest statement.
    candidates.sort(
      (a, b) =>
        Number(matchedBy.has(a.finding.id)) - Number(matchedBy.has(b.finding.id)) ||
        similarity(p.statement, b.finding.statement) - similarity(p.statement, a.finding.statement),
    );
    const best = candidates[0];
    result.matched = best.finding.id;
    result.how = best.how;
    result.duplicate = matchedBy.has(best.finding.id);
    if (!result.duplicate) matchedBy.set(best.finding.id, n);
    const expectedStatus = best.finding.status === 'confirmed' ? 'suggested' : best.finding.status;
    if (p.status === expectedStatus) statusAgrees++;
  });

  const kinds = new Map<string, KindScore>();
  const row = (kind: string) => {
    let r = kinds.get(kind);
    if (!r) kinds.set(kind, (r = { kind, proposed: 0, correct: 0, invented: 0, expected: 0, found: 0 }));
    return r;
  };
  for (const r of results) {
    const k = row(r.kind);
    k.proposed++;
    if (r.matched) k.correct++;
    if (r.problems.some((p) => INVENTED.includes(p))) k.invented++;
  }
  for (const f of answers.findings) {
    const k = row(f.kind);
    k.expected++;
    if (matchedBy.has(f.id)) k.found++;
  }
  const byKind = [...kinds.values()].sort(
    (a, b) => FINDING_KINDS.indexOf(a.kind as FindingKind) - FINDING_KINDS.indexOf(b.kind as FindingKind),
  );
  const total = byKind.reduce(
    (t, k) => ({
      kind: 'all',
      proposed: t.proposed + k.proposed,
      correct: t.correct + k.correct,
      invented: t.invented + k.invented,
      expected: t.expected + k.expected,
      found: t.found + k.found,
    }),
    { kind: 'all', proposed: 0, correct: 0, invented: 0, expected: 0, found: 0 },
  );
  return {
    consultation: answers.meeting,
    proposals: results,
    unclear,
    unsettled: unclear.filter((u) => !settled.has(key(u.proposal, u.key))).length,
    missed: answers.findings.filter((f) => !matchedBy.has(f.id)).map((f) => f.id),
    byKind,
    total,
    duplicates: results.filter((r) => r.duplicate).length,
    statusAgrees,
    dropped: results.filter((r) => r.problems.length).length,
  };
}

export const precision = (k: KindScore) => (k.proposed ? k.correct / k.proposed : null);
export const recall = (k: KindScore) => (k.expected ? k.found / k.expected : null);
export const inventedRate = (k: KindScore) => (k.proposed ? k.invented / k.proposed : null);

// ---------------------------------------------------------------------------
// The CSV of unclear matches
// ---------------------------------------------------------------------------

const CSV_HEADER = ['proposal', 'key', 'reason', 'proposed kind', 'proposed statement', 'key kind', 'key statement', 'match'];

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** The unclear pairs, for a person to settle: write yes or no in the last column. Answers already given are kept. */
export function unclearCsv(score: Score, answers: AnswerKey, proposals: RunProposal[], settled: Settled = new Map()): string {
  const rows = score.unclear.map((u) => {
    const p = proposals[u.proposal - 1];
    const k = answers.findings.find((f) => f.id === u.key)!;
    const answer = settled.get(key(u.proposal, u.key));
    return [
      String(u.proposal),
      u.key,
      u.reason,
      p.kind,
      p.statement,
      k.kind,
      k.statement,
      answer === undefined ? '' : answer ? 'yes' : 'no',
    ];
  });
  return [CSV_HEADER, ...rows].map((r) => r.map(csvField).join(',')).join('\r\n') + '\r\n';
}

/** Reads one CSV row at a time, with quoted fields. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) rows.push([...row, field]);
  return rows;
}

/** The settled pairs in a CSV written by `unclearCsv`. Rows without yes or no are left unsettled. */
export function readSettled(text: string): Map<string, boolean> {
  const settled = new Map<string, boolean>();
  const [header, ...rows] = parseCsv(text.replace(/^﻿/, ''));
  const at = (name: string) => header?.indexOf(name) ?? -1;
  const [p, k, m] = [at('proposal'), at('key'), at('match')];
  if (p < 0 || k < 0 || m < 0) return settled;
  for (const r of rows) {
    const answer = r[m]?.trim().toLowerCase();
    if (answer === 'yes' || answer === 'y') settled.set(key(Number(r[p]), r[k]), true);
    else if (answer === 'no' || answer === 'n') settled.set(key(Number(r[p]), r[k]), false);
  }
  return settled;
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

export const percent = (value: number | null) => (value === null ? '–' : `${Math.round(value * 100)}%`);

/** The scores as a Markdown table, one row per kind and a total. */
export function formatScore(score: Score): string {
  const line = (k: KindScore) =>
    `| ${k.kind} | ${k.proposed} | ${k.correct} | ${percent(precision(k))} | ${k.expected} | ${k.found} | ${percent(recall(k))} | ${percent(inventedRate(k))} |`;
  return [
    `| Kind | Proposed | Correct | Precision | Expected | Found | Recall | Invented evidence |`,
    `| --- | --: | --: | --: | --: | --: | --: | --: |`,
    ...score.byKind.map(line),
    line(score.total).replace('| all |', '| **All** |'),
    '',
    `Duplicates: ${score.duplicates}. Status agrees: ${score.statusAgrees}. Dropped by StyleCode's checks: ${score.dropped}. Unclear pairs: ${score.unclear.length} (${score.unsettled} not settled). Missed: ${score.missed.join(', ') || 'none'}.`,
  ].join('\n');
}
