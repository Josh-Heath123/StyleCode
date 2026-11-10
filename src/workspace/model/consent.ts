/**
 * Consent rules (ADR-0003), as specified in docs/spec/CONSENT.md (rules C1 to
 * C11), so the domain model can't represent a captured or AI-processed session
 * without consent.
 */
import {
  CONSENT_STATEMENTS,
  type AiProcessing,
  type CompanyWorkspace,
  type ConsentAmendment,
  type ConsentGiven,
  type ConsentOutcome,
  type ConsentRecord,
  type ConsentStatement,
  type ConsentTold,
  type Retention,
  type Timestamp,
} from './types.ts';
import { fail, get, isNonEmptyText, isTimestamp, ok, time, type Result } from './util.ts';

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

const TOLD_KEYS: readonly string[] = [...CONSENT_STATEMENTS, 'externalProvider'];

/** Problems with what a record says the client was told: yes or no per statement, and the provider the external statement named. */
export function toldIssues(t: unknown): ConsentIssue[] {
  const told = t as Record<string, unknown> | null;
  if (!told || typeof told !== 'object' || !CONSENT_STATEMENTS.every((k) => typeof told[k] === 'boolean'))
    return [{ code: 'field.type', message: 'What the client was told must be yes or no.' }];
  if (Object.keys(told).some((k) => !TOLD_KEYS.includes(k)))
    return [{ code: 'field.value', message: 'The consent record says the client was told something the form does not have.' }];
  if (told.processingExternal === true && !isNonEmptyText(told.externalProvider))
    return [{ code: 'consent.provider', message: 'Name the external AI provider the client was told about.' }];
  if (told.processingExternal !== true && told.externalProvider !== null)
    return [{ code: 'consent.provider', message: 'A provider is named only when the client was told about external AI.' }];
  return [];
}

/** Problems with the fields an amendment sets, before it is applied. */
export function amendmentIssues(a: ConsentAmendment): ConsentIssue[] {
  if (a.kind === 'withdrawal') return [];
  const issues: ConsentIssue[] = [];
  if (a.told !== undefined) {
    // An amendment records what the client was newly told; it can't take back what they heard.
    const t = a.told as Record<string, unknown> | null;
    if (!t || typeof t !== 'object' || Object.keys(t).some((k) => !TOLD_KEYS.includes(k))) {
      issues.push({ code: 'field.value', message: 'An amendment says the client was told something the form does not have.' });
    } else if (!CONSENT_STATEMENTS.some((k) => t[k] === true) || CONSENT_STATEMENTS.some((k) => k in t && t[k] !== true)) {
      issues.push({ code: 'field.value', message: 'An amendment lists only the statements the client was newly told.' });
    } else if (t.processingExternal === true ? !isNonEmptyText(t.externalProvider) : 'externalProvider' in t) {
      issues.push({ code: 'consent.provider', message: 'Name the external AI provider the client was told about.' });
    }
    if (!isNonEmptyText(a.wordingVersion))
      issues.push({
        code: 'consent.wording',
        message: 'An amendment that records what the client was told names the wording shown.',
      });
  } else if (a.wordingVersion !== undefined) {
    issues.push({
      code: 'consent.wording',
      message: 'An amendment names a wording only when it records what the client was told.',
    });
  }
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

/**
 * The retention the client was last told about, once the record and its first
 * `count` amendments were made: the retention in force each time the
 * retention statement was told. Null if it never was.
 */
export function retentionTold(record: ConsentRecord, count: number): Retention | null {
  let terms = termsOf(record);
  let told = record.told?.retention === true ? terms.retention : null;
  for (const a of (Array.isArray(record.amendments) ? record.amendments : []).slice(0, count)) {
    if (!a || typeof a !== 'object' || a.kind !== 'change') continue;
    terms = applyAmendment(terms, a);
    if (a.told?.retention === true) told = terms.retention;
  }
  return told;
}

/**
 * While audio recording is agreed, the client must have been told the
 * retention in force in its own words (Phase 2 brief, decision 10). So an
 * amendment that leaves audio agreed with a retention other than the one last
 * told needs the retention statement told again, whether it changes the
 * retention or turns audio on after an earlier change. `count` is the number
 * of amendments before this one. (Never told at all is rule C2's to report.)
 */
export function retentionToldIssue(record: ConsentRecord, count: number, a: ConsentAmendment): ConsentIssue | null {
  if (a.kind !== 'change' || a.told?.retention === true) return null;
  let before = termsOf(record);
  for (const earlier of (Array.isArray(record.amendments) ? record.amendments : []).slice(0, count))
    if (earlier && typeof earlier === 'object') before = applyAmendment(before, earlier);
  const after = applyAmendment(before, a);
  const told = retentionTold(record, count);
  if (!after.given.audioRecording || told === null || JSON.stringify(after.retention) === JSON.stringify(told)) return null;
  return {
    code: 'consent.told',
    message: 'The client was told how long audio is kept in the old words. Tell them the new retention, and record it.',
  };
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
    // An amendment whose date can't be read is never treated as in force (the validator reports it).
    if (!amendment || typeof amendment !== 'object' || !isTimestamp(amendment.at)) continue;
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

/** What the client must have been told before agreeing to each item (CONSENT.md, rule C2; decision 2). */
export const TOLD_FOR: Record<'audioRecording' | 'transcription' | 'aiLocal' | 'aiExternal', ConsentStatement[]> = {
  audioRecording: ['recorded', 'retention'],
  transcription: ['transcribed'],
  aiLocal: ['aiExtraction', 'processingLocal'],
  aiExternal: ['aiExtraction', 'processingExternal'],
};

/** Everything a client has been told up to a point: the statements, and each provider the external statement named. */
export interface ToldSoFar {
  statements: ReadonlySet<ConsentStatement>;
  providers: readonly string[];
}

const TOLD_NOTHING: ToldSoFar = { statements: new Set(), providers: [] };

/** Adds what the client was told (on the form, or newly in an amendment) to what they had been told before. */
export function addTold(before: ToldSoFar, told: Partial<ConsentTold> | null | undefined): ToldSoFar {
  if (!told || typeof told !== 'object') return before;
  const statements = new Set(before.statements);
  for (const s of CONSENT_STATEMENTS) if (told[s] === true) statements.add(s);
  const provider = told.processingExternal === true && isNonEmptyText(told.externalProvider) ? told.externalProvider : null;
  return { statements, providers: provider === null ? before.providers : [...before.providers, provider] };
}

/**
 * What the client had been told once the record and its first `count`
 * amendments (default: all of them) were made (decision 3).
 */
export function toldSoFar(record: ConsentRecord, count?: number): ToldSoFar {
  let told = addTold(TOLD_NOTHING, record.told);
  const amendments = Array.isArray(record.amendments) ? record.amendments.slice(0, count) : [];
  for (const a of amendments) if (a && typeof a === 'object' && a.kind === 'change') told = addTold(told, a.told);
  return told;
}

/** Statements the client wasn't told but agreed to, plus "can stop or delete", needed whenever anything is agreed. */
export function missingStatements(record: ConsentRecord): ConsentStatement[] {
  return missingFor(addTold(TOLD_NOTHING, record.told), record.given);
}

/**
 * The same check for any answers against everything told so far, such as the
 * terms after an amendment. Agreeing to external AI also needs the external
 * statement to have named that provider; if it named only others, the
 * statement counts as missing.
 */
export function missingFor(told: ToldSoFar, givenIn: ConsentGiven | null | undefined): ConsentStatement[] {
  const given = (givenIn ?? {}) as Partial<ConsentGiven>;
  const needed = new Set<ConsentStatement>();
  for (const [item, statements] of Object.entries(TOLD_FOR)) {
    if (given[item as keyof typeof TOLD_FOR] === true) for (const s of statements) needed.add(s);
  }
  if (needed.size) needed.add('canStopOrDelete');
  const missing = [...needed].filter((s) => !told.statements.has(s));
  // A "yes" with no provider named is reported as a missing provider (termsIssues), not here.
  if (
    given.aiExternal === true &&
    isNonEmptyText(given.externalProvider) &&
    told.statements.has('processingExternal') &&
    !told.providers.some((p) => sameProvider(p, given.externalProvider))
  ) {
    missing.push('processingExternal');
  }
  return missing;
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
/** Ollama's cloud models, such as "gpt-oss:120b-cloud" or "kimi-k2:cloud". */
const OLLAMA_CLOUD = /[-:]cloud$/i;

/**
 * Where a configured AI provider runs, for the consent rules (MVP Q16,
 * CONSENT.md rule C6). Local only if it is Ollama or an OpenAI-compatible
 * server at a loopback address; Ollama on another computer counts as
 * external, and so does an Ollama cloud model (its name ends in "-cloud" or
 * ":cloud"): Ollama sends it to ollama.com even from a local address.
 * External providers are named by company and host, for example
 * "Anthropic (api.anthropic.com)", and the consent form offers that name.
 */
export function classifyProvider(settings: {
  provider: 'ollama' | 'openai' | 'anthropic';
  baseUrl: string;
  model?: string;
}): AiProcessing {
  if (settings.provider === 'ollama' && OLLAMA_CLOUD.test(settings.model?.trim() ?? '')) {
    return { kind: 'external', provider: 'Ollama Cloud (ollama.com)' };
  }
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

/** The speaker warning kept on a transcript (rule C11). */
export interface SpeakerCheck {
  unaskedSpeakers: string[];
  unnamedSpeakers: boolean;
}

/**
 * Speakers in a transcript about to be imported who weren't asked for consent:
 * labels that match neither a client participant named on the consent form
 * nor a participant on the consultant's side. The import can go ahead; the
 * result is kept on the transcript as a warning (rule C11).
 */
export function checkSpeakers(ws: CompanyWorkspace, sessionId: string, labels: readonly (string | null)[]): SpeakerCheck {
  const asked = new Set(consentFor(ws, sessionId)?.askedParticipantIds ?? []);
  const covered = new Set<string>();
  for (const p of Object.values(ws.participants)) {
    if (p.sessionId === sessionId && (p.side === 'consultant' || asked.has(p.id)))
      for (const l of p.speakerLabels) covered.add(l);
  }
  const unasked: string[] = [];
  for (const label of labels) {
    if (label !== null && !covered.has(label) && !unasked.includes(label)) unasked.push(label);
  }
  return { unaskedSpeakers: unasked, unnamedSpeakers: labels.includes(null) };
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

/**
 * Adds a dated amendment. Amendments are never edited or removed. A change
 * needs a locked record (an unlocked one is edited directly). A withdrawal
 * works on any confirmed record, and locks it if it isn't locked yet.
 */
export function amendConsent(record: ConsentRecord, amendment: ConsentAmendment): Result<ConsentRecord> {
  if (!record.confirmed) return fail('Confirm the consent form first.');
  if (!record.lockedAt && amendment.kind !== 'withdrawal') return fail('The consent record is not locked yet. Edit it directly.');
  const last = record.amendments.at(-1);
  if (time(amendment.at) < time(last?.at ?? record.lockedAt ?? record.confirmed.at))
    return fail('An amendment cannot be dated before the last change.');
  if (!amendment.reason.trim()) return fail('Say why consent changed.');
  if (record.amendments.some((a) => a.kind === 'withdrawal')) return fail('Consent for this session was withdrawn.');
  const before = record.amendments.reduce(applyAmendment, termsOf(record));
  const after = applyAmendment(before, amendment);
  const issue =
    amendmentIssues(amendment)[0] ?? termsIssues(after)[0] ?? retentionToldIssue(record, record.amendments.length, amendment);
  if (issue) return fail(issue.message);
  // Rule C2 holds for amendments too: each "yes" is checked against everything the client has been told so far.
  const toldBefore = toldSoFar(record);
  const toldAfter = amendment.kind === 'change' ? addTold(toldBefore, amendment.told) : toldBefore;
  const missing = missingFor(toldAfter, after.given).filter((s) => !missingFor(toldBefore, before.given).includes(s));
  if (missing.length) return fail(`The client wasn't told about this (${missing.join(', ')}), so they can't agree to it.`);
  return ok({
    ...record,
    lockedAt: record.lockedAt ?? amendment.at,
    amendments: [...record.amendments, amendment],
    updatedAt: amendment.at,
  });
}
