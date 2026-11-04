/**
 * Consent rules (ADR-0003), as specified in docs/spec/CONSENT.md (rules C1 to
 * C10), so the domain model can't represent a captured or AI-processed session
 * without consent.
 */
import type {
  AiProcessing,
  CompanyWorkspace,
  ConsentAmendment,
  ConsentGiven,
  ConsentOutcome,
  ConsentRecord,
  Retention,
  Timestamp,
} from './types';
import { fail, get, isNonEmptyText, ok, time, type Result } from './util';

/** What a consent record agrees to: the terms an amendment can change. */
export interface ConsentTerms {
  given: ConsentGiven;
  retention: Retention;
  outcome: ConsentOutcome;
}

/** A problem with consent terms or an amendment, with the validator's code. */
export interface ConsentIssue {
  code: string;
  message: string;
}

const GIVEN_FLAGS = ['audioRecording', 'transcription', 'aiLocal', 'aiExternal'] as const;
const GIVEN_KEYS: readonly string[] = [...GIVEN_FLAGS, 'externalProvider'];

function retentionIssues(r: unknown): ConsentIssue[] {
  const kind = (r as { kind?: unknown } | null | undefined)?.kind;
  if (kind === 'days') {
    const days = (r as { days?: unknown }).days;
    if (!Number.isInteger(days) || (days as number) < 1)
      return [{ code: 'consent.retention', message: 'Retention in days must be a whole number of at least 1.' }];
    return [];
  }
  if (kind === 'until-engagement-ends' || kind === 'delete-after-transcription') return [];
  return [{ code: 'field.value', message: 'The consent record has an unknown retention.' }];
}

function outcomeIssues(o: unknown): ConsentIssue[] {
  const outcome = o as { kind?: unknown; limits?: unknown } | null | undefined;
  if (!outcome || !['given', 'limited', 'declined'].includes(outcome.kind as string))
    return [{ code: 'field.value', message: 'The consent record has an unknown outcome.' }];
  if (outcome.kind === 'limited' && !isNonEmptyText(outcome.limits))
    return [{ code: 'consent.limits', message: 'Describe the limits the client set.' }];
  return [];
}

/**
 * Problems with a set of terms, whether the record's own or the terms after an
 * amendment: yes-or-no answers, a named provider whenever external AI is
 * agreed, limits described, and nothing agreed when consent is declined.
 */
export function termsIssues(terms: ConsentTerms): ConsentIssue[] {
  const issues: ConsentIssue[] = [];
  const g = terms.given as unknown as Record<string, unknown> | null;
  if (!g || typeof g !== 'object' || !GIVEN_FLAGS.every((k) => typeof g[k] === 'boolean')) {
    issues.push({ code: 'field.type', message: 'What the client agreed to must be yes or no.' });
  } else {
    if (g.aiExternal && !isNonEmptyText(g.externalProvider))
      issues.push({ code: 'consent.provider', message: 'Name the external AI provider the client agreed to.' });
    if (!g.aiExternal && g.externalProvider !== null)
      issues.push({ code: 'consent.provider', message: 'An external provider is named only when the client agreed to one.' });
  }
  issues.push(...retentionIssues(terms.retention), ...outcomeIssues(terms.outcome));
  if (
    (terms.outcome as { kind?: unknown } | null)?.kind === 'declined' &&
    g &&
    typeof g === 'object' &&
    GIVEN_FLAGS.some((k) => g[k] === true)
  ) {
    issues.push({ code: 'consent.declined', message: 'Declined consent cannot agree to anything.' });
  }
  return issues;
}

/** Problems with the fields an amendment sets, before it is applied. */
export function amendmentIssues(a: ConsentAmendment): ConsentIssue[] {
  if (a.kind === 'withdrawal') return [];
  const issues: ConsentIssue[] = [];
  if (a.given !== undefined) {
    const g = a.given as Record<string, unknown> | null;
    if (!g || typeof g !== 'object' || Object.keys(g).some((k) => !GIVEN_KEYS.includes(k))) {
      issues.push({ code: 'field.value', message: 'An amendment changes something the consent form does not have.' });
    } else {
      if (GIVEN_FLAGS.some((k) => k in g && typeof g[k] !== 'boolean'))
        issues.push({ code: 'field.type', message: 'What the client agreed to must be yes or no.' });
      if ('externalProvider' in g && g.externalProvider !== null && !isNonEmptyText(g.externalProvider))
        issues.push({ code: 'consent.provider', message: 'Name the external AI provider the client agreed to.' });
    }
  }
  if (a.retention !== undefined) issues.push(...retentionIssues(a.retention));
  if (a.outcome !== undefined) issues.push(...outcomeIssues(a.outcome));
  return issues;
}

/**
 * The terms after one amendment. Turning external AI off also drops the named
 * provider, unless the amendment names one itself (which `termsIssues` then refuses).
 */
export function applyAmendment(terms: ConsentTerms, a: ConsentAmendment): ConsentTerms {
  if (a.kind !== 'change') return terms;
  let given: ConsentGiven = { ...terms.given, ...a.given };
  if (!given.aiExternal && !(a.given && 'externalProvider' in a.given)) given = { ...given, externalProvider: null };
  return { given, retention: a.retention ?? terms.retention, outcome: a.outcome ?? terms.outcome };
}

function termsOf(record: ConsentRecord): ConsentTerms {
  return { given: record.given, retention: record.retention, outcome: record.outcome };
}

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
  let terms = termsOf(record);
  let withdrawn = false;
  const until = at === undefined ? Infinity : time(at);
  for (const amendment of Array.isArray(record.amendments) ? record.amendments : []) {
    if (!amendment || typeof amendment !== 'object') continue;
    if (time(amendment.at) > until) break;
    if (amendment.kind === 'withdrawal') withdrawn = true;
    else terms = applyAmendment(terms, amendment);
  }
  let given: ConsentGiven = { ...terms.given };
  const { retention, outcome } = terms;
  const confirmed = !!record.confirmed && (at === undefined || time(record.confirmed.at) <= until);
  if (!confirmed || withdrawn || outcome?.kind === 'declined') given = { ...NOTHING };
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

/** What the client must have been told before agreeing to each item (CONSENT.md, rule C2). */
export const TOLD_FOR: Record<'audioRecording' | 'transcription' | 'aiLocal' | 'aiExternal', (keyof ConsentRecord['told'])[]> = {
  audioRecording: ['recorded', 'retention'],
  transcription: ['transcribed'],
  aiLocal: ['aiExtraction', 'processingLocation'],
  aiExternal: ['aiExtraction', 'processingLocation'],
};

/** Statements the client wasn't told but agreed to, plus "can stop or delete", needed whenever anything is agreed. */
export function missingStatements(record: ConsentRecord): (keyof ConsentRecord['told'])[] {
  const told = (record.told ?? {}) as Partial<ConsentRecord['told']>;
  const given = (record.given ?? {}) as Partial<ConsentGiven>;
  const needed = new Set<keyof ConsentRecord['told']>();
  for (const [item, statements] of Object.entries(TOLD_FOR)) {
    if (given[item as keyof typeof TOLD_FOR] === true) for (const s of statements) needed.add(s);
  }
  if (needed.size) needed.add('canStopOrDelete');
  return [...needed].filter((s) => told[s] !== true);
}

/**
 * Whether the AI may process a session's transcript and notes, where it would
 * run, at a point in time (default: now), and if not, a reason to show.
 */
export function canUseAi(ws: CompanyWorkspace, sessionId: string, processing: AiProcessing, at?: Timestamp): Result<true> {
  const record = consentFor(ws, sessionId);
  if (!record || !record.confirmed) return fail('Fill in and confirm the consent form for this session first.');
  const state = consentState(record, at);
  if (state.withdrawn) return fail('The client withdrew consent for this session.');
  if (state.outcome?.kind === 'declined') return fail('The client declined consent, so the AI does not process this session.');
  if (processing.kind === 'local') {
    return state.given.aiLocal ? ok(true) : fail('The client did not agree to AI processing on this computer.');
  }
  if (!state.given.aiExternal) return fail('The client did not agree to an external AI provider. Use a model on this computer.');
  if (!sameProvider(state.given.externalProvider, processing.provider)) {
    return fail(`The client agreed to ${state.given.externalProvider}, not ${processing.provider}.`);
  }
  return ok(true);
}

/** Provider names are compared ignoring case and surrounding spaces. */
export function sameProvider(a: string | null | undefined, b: string | null | undefined): boolean {
  return typeof a === 'string' && typeof b === 'string' && a.trim().toLowerCase() === b.trim().toLowerCase() && a.trim() !== '';
}

const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|\[::1\]|::1)$/i;

/**
 * Where a configured AI provider runs, for the consent rules (MVP Q16,
 * CONSENT.md rule C6). Local only if it is Ollama or an OpenAI-compatible
 * server at a loopback address; Ollama on another computer counts as
 * external. External providers are named by company and host, for example
 * "Anthropic (api.anthropic.com)", and the consent form offers that name.
 */
export function classifyProvider(settings: { provider: 'ollama' | 'openai' | 'anthropic'; baseUrl: string }): AiProcessing {
  let host: string;
  try {
    host = new URL(settings.baseUrl).hostname.toLowerCase();
  } catch {
    host = settings.baseUrl.trim().toLowerCase() || 'unknown address';
  }
  if (settings.provider !== 'anthropic' && LOOPBACK.test(host)) return { kind: 'local' };
  const company =
    settings.provider === 'anthropic'
      ? 'Anthropic'
      : settings.provider === 'ollama'
        ? 'Ollama'
        : host === 'api.openai.com'
          ? 'OpenAI'
          : 'OpenAI-compatible service';
  return { kind: 'external', provider: `${company} (${host})` };
}

/** Changes to a record that is still unlocked. A locked record only takes amendments. */
export function editConsent(
  record: ConsentRecord,
  changes: Partial<Omit<ConsentRecord, 'id' | 'sessionId' | 'lockedAt' | 'amendments' | 'createdAt' | 'updatedAt'>>,
  at: Timestamp,
): Result<ConsentRecord> {
  if (record.lockedAt) return fail('The consent record is locked. Add an amendment instead.');
  // Changing what was recorded means confirming it again (CONSENT.md, rule C3). Attaching a file doesn't.
  const reconfirm = Object.keys(changes).some((key) => key !== 'attachmentFileId' && key !== 'confirmed');
  const confirmed = 'confirmed' in changes ? (changes.confirmed ?? null) : reconfirm ? null : record.confirmed;
  return ok({ ...record, ...changes, confirmed, updatedAt: at });
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
  const before = record.amendments.reduce(applyAmendment, termsOf(record));
  const issue = amendmentIssues(amendment)[0] ?? termsIssues(applyAmendment(before, amendment))[0];
  if (issue) return fail(issue.message);
  return ok({ ...record, amendments: [...record.amendments, amendment], updatedAt: amendment.at });
}
