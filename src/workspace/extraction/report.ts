/**
 * How the AI did on a session, from real use (Phase 2 brief, WP7; the
 * roadmap's evaluation report): its proposals by the kind it proposed, and
 * what the consultant did with each. Built from `origin.proposed` and the
 * review states, on this computer only. Pure.
 */
import type { CompanyWorkspace, Finding, FindingKind } from '../model/types.ts';
import { FINDING_KINDS } from '../model/types.ts';

export interface ReviewCounts {
  kind: FindingKind | 'all';
  proposed: number;
  /** Accepted as the AI proposed it. */
  accepted: number;
  /** Accepted after the consultant changed its kind, statement, status or evidence. */
  edited: number;
  rejected: number;
  /** Still waiting for review. */
  pending: number;
}

/**
 * Whether the consultant changed the proposal as they accepted it: its kind,
 * statement or evidence. Choosing a status is part of accepting (decision 8),
 * and later changes in the record don’t count.
 */
export function editedOnAccepting(f: Finding): boolean {
  if (f.origin.kind !== 'ai' || f.origin.review.state !== 'accepted') return false;
  const acceptedAt = f.origin.review.at;
  return f.history.some((h) => h.field !== 'status' && h.at <= acceptedAt);
}

/** The AI's proposals from one session, by the kind it proposed, then all together. Kinds it never proposed are left out. */
export function reviewReport(ws: CompanyWorkspace, sessionId: string): { byKind: ReviewCounts[]; total: ReviewCounts } {
  const empty = (kind: ReviewCounts['kind']): ReviewCounts => ({
    kind,
    proposed: 0,
    accepted: 0,
    edited: 0,
    rejected: 0,
    pending: 0,
  });
  const byKind = new Map<FindingKind, ReviewCounts>();
  const total = empty('all');
  for (const f of Object.values(ws.findings)) {
    if (f.origin.kind !== 'ai' || !f.origin.inputSessionIds.includes(sessionId)) continue;
    const kind = f.origin.proposed.kind;
    const row = byKind.get(kind) ?? empty(kind);
    byKind.set(kind, row);
    const state = f.origin.review.state;
    const column = state === 'accepted' ? (editedOnAccepting(f) ? 'edited' : 'accepted') : state;
    for (const r of [row, total]) {
      r.proposed++;
      r[column]++;
    }
  }
  return { byKind: FINDING_KINDS.flatMap((k) => byKind.get(k) ?? []), total };
}
