/**
 * Consent rules (ADR-0003). The full form is specified in docs/spec/CONSENT.md
 * (WP5); these are the rules the Phase 0 brief already fixes, so the domain
 * model can't represent a captured session without consent.
 *
 * Provisional until WP5: importing a transcript requires transcription = yes.
 */
import type {
  CompanyWorkspace,
  ConsentAmendment,
  ConsentGiven,
  ConsentOutcome,
  ConsentRecord,
  Retention,
  Timestamp,
} from './types';
import { fail, get, ok, time, type Result } from './util';

/** What a consent record allows at a point in time, after its amendments up to then. */
export interface ConsentState {
  given: ConsentGiven;
  retention: Retention;
  outcome: ConsentOutcome;
  withdrawn: boolean;
}

const NOTHING: ConsentGiven = {
  audioRecording: false,
  transcription: false,
  aiLocal: false,
  aiExternal: false,
  externalProvider: null,
};

/**
 * The record's state at `at` (default: now, including every amendment). A
 * draft (unconfirmed) record allows nothing, and neither does a declined or
 * withdrawn one.
 */
export function consentState(record: ConsentRecord, at?: Timestamp): ConsentState {
  let given: ConsentGiven = { ...record.given };
  let retention = record.retention;
  let outcome = record.outcome;
  let withdrawn = false;
  const until = at === undefined ? Infinity : time(at);
  for (const amendment of record.amendments) {
    if (time(amendment.at) > until) break;
    if (amendment.kind === 'withdrawal') {
      withdrawn = true;
      continue;
    }
    if (amendment.given) given = { ...given, ...amendment.given };
    if (amendment.retention) retention = amendment.retention;
    if (amendment.outcome) outcome = amendment.outcome;
  }
  const confirmed = record.confirmed !== null && (at === undefined || time(record.confirmed.at) <= until);
  if (!confirmed || withdrawn || outcome.kind === 'declined') given = { ...NOTHING };
  if (!given.aiExternal) given = { ...given, externalProvider: null };
  return { given, retention, outcome, withdrawn };
}

/** The session's consent record, if it has one. */
export function consentFor(ws: CompanyWorkspace, sessionId: string): ConsentRecord | null {
  return Object.values(ws.consents).find((c) => c.sessionId === sessionId) ?? null;
}

export type Capture = 'recording' | 'transcript-import';

/**
 * Whether a session may be recorded, or have a transcript imported or pasted,
 * and if not, a reason to show the consultant.
 */
export function canCapture(ws: CompanyWorkspace, sessionId: string, capture: Capture, at?: Timestamp): Result<true> {
  if (!get(ws.sessions, sessionId)) return fail('The session does not exist.');
  const record = consentFor(ws, sessionId);
  if (!record) return fail('Fill in the consent form for this session first.');
  if (!record.confirmed) return fail('Confirm the consent form for this session first.');
  const state = consentState(record, at);
  if (state.withdrawn) return fail('The client withdrew consent for this session.');
  if (state.outcome.kind === 'declined') return fail('The client declined consent, so this session can only have notes.');
  if (capture === 'recording' && !state.given.audioRecording) return fail('The client did not agree to audio recording.');
  if (capture === 'transcript-import' && !state.given.transcription) return fail('The client did not agree to transcription.');
  if (capture === 'transcript-import' && get(ws.transcripts, transcriptIdFor(ws, sessionId))) {
    return fail('This session already has a transcript.');
  }
  return ok(true);
}

function transcriptIdFor(ws: CompanyWorkspace, sessionId: string): string | undefined {
  return Object.values(ws.transcripts).find((t) => t.sessionId === sessionId)?.id;
}

/** Where the AI may process a session's data: its transcript and its notes (MVP Q15). */
export interface AiPermission {
  local: boolean;
  external: boolean;
  /** The provider the client agreed to, when `external` is true. */
  externalProvider: string | null;
}

/**
 * What AI processing a session's consent allows. A session without a confirmed
 * record allows none. Whether a configured provider counts as local or external
 * (for example Ollama on another computer, MVP Q16) is decided by the caller.
 */
export function aiPermission(ws: CompanyWorkspace, sessionId: string, at?: Timestamp): AiPermission {
  const record = consentFor(ws, sessionId);
  if (!record) return { local: false, external: false, externalProvider: null };
  const { given } = consentState(record, at);
  return { local: given.aiLocal, external: given.aiExternal, externalProvider: given.externalProvider };
}

/** Changes to a record that is still unlocked. A locked record only takes amendments. */
export function editConsent(
  record: ConsentRecord,
  changes: Partial<Omit<ConsentRecord, 'id' | 'sessionId' | 'lockedAt' | 'amendments' | 'createdAt' | 'updatedAt'>>,
  at: Timestamp,
): Result<ConsentRecord> {
  if (record.lockedAt) return fail('The consent record is locked. Add an amendment instead.');
  return ok({ ...record, ...changes, updatedAt: at });
}

/** Locks the record, when recording starts or a transcript is imported. Locking twice keeps the first time. */
export function lockConsent(record: ConsentRecord, at: Timestamp): Result<ConsentRecord> {
  if (!record.confirmed) return fail('Only a confirmed consent record can be locked.');
  if (record.lockedAt) return ok(record);
  return ok({ ...record, lockedAt: at, updatedAt: at });
}

/** Adds a dated amendment to a locked record. Amendments are never edited or removed. */
export function amendConsent(record: ConsentRecord, amendment: ConsentAmendment): Result<ConsentRecord> {
  if (!record.lockedAt) return fail('The consent record is not locked yet. Edit it directly.');
  const last = record.amendments.at(-1);
  if (time(amendment.at) < time(last?.at ?? record.lockedAt)) return fail('An amendment cannot be dated before the last change.');
  if (!amendment.reason.trim()) return fail('Say why consent changed.');
  if (record.amendments.some((a) => a.kind === 'withdrawal')) return fail('Consent for this session was withdrawn.');
  return ok({ ...record, amendments: [...record.amendments, amendment], updatedAt: amendment.at });
}
