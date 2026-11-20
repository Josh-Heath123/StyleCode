/**
 * Which of an engagement's findings the canvas AI may be given, and why the
 * others are left out (Workspace Phase 4, decisions 13 and 14; CONSENT.md, C5
 * as extended). Pure: the app checks it again before every request.
 *
 * - Only findings in the record with status "confirmed", and of them only the
 *   statement and kind (the caller sends nothing else).
 * - A finding rests on the sessions of its evidence and, if the AI proposed
 *   it, every session it was given. Each must allow this AI (`canUseAi`) and
 *   have been told `aiDesign`, on the form or later by an amendment.
 * - A finding resting on no session goes only to an AI on this computer.
 * - A session since deleted took its consent record with it, so a finding
 *   resting on one is left out.
 */
import { canUseAi, consentFor, toldSoFar } from './consent.ts';
import { isInRecord } from './findings.ts';
import { evidenceSession } from './record.ts';
import type { AiProcessing, CompanyWorkspace, Finding, Timestamp } from './types.ts';
import { get, isTimestamp, time } from './util.ts';

/** Why a confirmed finding was left out, most serious first: a finding is counted under its first reason only. */
export const LEFT_OUT_REASONS = ['session-deleted', 'not-allowed', 'not-told', 'no-session'] as const;
export type LeftOutReason = (typeof LEFT_OUT_REASONS)[number];

export interface DesignFindings {
  /** The confirmed findings the request may use, oldest first (the context orders them, decision 15). */
  findings: Finding[];
  /** How many confirmed findings were left out, by reason. */
  leftOut: Record<LeftOutReason, number>;
}

/** The sessions a finding rests on: its evidence's, and for one the AI proposed, every session it was given. */
export function sessionsOf(ws: CompanyWorkspace, f: Finding): string[] {
  const ids = f.evidence.map((e) => evidenceSession(ws, e)).filter((id): id is string => id !== null);
  if (f.origin.kind === 'ai') ids.push(...f.origin.inputSessionIds);
  return [...new Set(ids)];
}

/** Whether the client had been told `aiDesign` by `at` (default: now), on the form or by an amendment (decision 13). */
export function toldAiDesign(ws: CompanyWorkspace, sessionId: string, at?: Timestamp): boolean {
  const record = consentFor(ws, sessionId);
  if (!record) return false;
  const count =
    at === undefined ? undefined : record.amendments.filter((a) => isTimestamp(a.at) && time(a.at) <= time(at)).length;
  return toldSoFar(record, count).statements.has('aiDesign');
}

function reasonFor(ws: CompanyWorkspace, f: Finding, processing: AiProcessing, at?: Timestamp): LeftOutReason | null {
  const sessions = sessionsOf(ws, f);
  if (!sessions.length) return processing.kind === 'local' ? null : 'no-session';
  if (sessions.some((id) => !get(ws.sessions, id))) return 'session-deleted';
  if (sessions.some((id) => !canUseAi(ws, id, processing, at).ok)) return 'not-allowed';
  if (sessions.some((id) => !toldAiDesign(ws, id, at))) return 'not-told';
  return null;
}

/** The findings of an engagement a canvas request may use, for the AI set up now (`processing`), at `at` (default: now). */
export function findingsForDesign(
  ws: CompanyWorkspace,
  engagementId: string,
  processing: AiProcessing,
  at?: Timestamp,
): DesignFindings {
  const leftOut = Object.fromEntries(LEFT_OUT_REASONS.map((r) => [r, 0])) as Record<LeftOutReason, number>;
  const findings: Finding[] = [];
  const candidates = Object.values(ws.findings)
    .filter((f) => f.engagementId === engagementId && isInRecord(f) && f.status === 'confirmed')
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1));
  for (const f of candidates) {
    const reason = reasonFor(ws, f, processing, at);
    if (reason) leftOut[reason] += 1;
    else findings.push(f);
  }
  return { findings, leftOut };
}

/**
 * What the assistant says about the findings left out, one sentence per reason, for example "3 findings left out:
 * their sessions don't allow this provider." Null when none was.
 */
export function leftOutMessage(leftOut: Record<LeftOutReason, number>, processing: AiProcessing): string | null {
  const sentences: string[] = [];
  for (const reason of LEFT_OUT_REASONS) {
    const n = leftOut[reason];
    if (!n) continue;
    const one = n === 1;
    const why = {
      'session-deleted': one ? 'a session it came from was deleted' : 'a session they came from was deleted',
      'not-allowed':
        processing.kind === 'local'
          ? `${one ? 'its session doesn’t' : 'their sessions don’t'} allow AI on this computer`
          : `${one ? 'its session doesn’t' : 'their sessions don’t'} allow this provider`,
      'not-told': 'the client wasn’t told the AI may help sketch the screens',
      'no-session': `${one ? 'it cites' : 'they cite'} no session, so ${one ? 'it goes' : 'they go'} only to an AI on this computer`,
    }[reason];
    sentences.push(`${n} ${one ? 'finding' : 'findings'} left out: ${why}.`);
  }
  return sentences.length ? sentences.join(' ') : null;
}
