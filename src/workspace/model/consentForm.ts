/**
 * The consent form (MVP story 3.1; docs/spec/CONSENT.md): its values, what
 * stops it being saved or confirmed, and saving it as the session's consent
 * record. Pure, so saving is one undoable step.
 */
import {
  addTold,
  amendConsent,
  consentFor,
  consentState,
  missingFor,
  retentionTold,
  retentionToldIssue,
  termsIssues,
  toldIssues,
  toldSoFar,
  type ToldSoFar,
} from './consent.ts';
import {
  CONSENT_STATEMENTS,
  type CompanyWorkspace,
  type ConsentAmendment,
  type ConsentGiven,
  type ConsentMethod,
  type ConsentOutcome,
  type ConsentRecord,
  type ConsentStatement,
  type ConsentTold,
  type Retention,
  type Timestamp,
} from './types.ts';
import { createId, fail, get, isNonEmptyText, ok, type Result } from './util.ts';
import { CURRENT_WORDING } from './wording.ts';
import { ID_PREFIX } from './workspace.ts';

export interface ConsentFormValues {
  askedParticipantIds: string[];
  method: ConsentMethod;
  told: ConsentTold;
  given: ConsentGiven;
  retention: Retention;
  outcome: ConsentOutcome;
  /** "I asked for consent as recorded above." */
  confirm: boolean;
}

const NOTHING_GIVEN: ConsentGiven = {
  audioRecording: false,
  transcription: false,
  aiLocal: false,
  aiExternal: false,
  externalProvider: null,
};
const NOTHING_TOLD: ConsentTold = {
  ...(Object.fromEntries(CONSENT_STATEMENTS.map((s) => [s, false])) as Record<ConsentStatement, boolean>),
  externalProvider: null,
};

/** The form's values: the session's record, or a blank form. */
export function consentFormFor(ws: CompanyWorkspace, sessionId: string): ConsentFormValues {
  const record = consentFor(ws, sessionId);
  if (record) {
    const { askedParticipantIds, method, told, given, retention, outcome } = record;
    return { askedParticipantIds, method, told, given, retention, outcome, confirm: record.confirmed !== null };
  }
  return {
    askedParticipantIds: [],
    method: { kind: 'verbal-at-start' },
    told: NOTHING_TOLD,
    given: NOTHING_GIVEN,
    retention: { kind: 'until-engagement-ends' },
    outcome: { kind: 'given' },
    confirm: false,
  };
}

/** Declined consent agrees to nothing (CONSENT.md: "Choosing Declined sets every answer to no"). */
export function decline(values: ConsentFormValues): ConsentFormValues {
  return { ...values, outcome: { kind: 'declined' }, given: NOTHING_GIVEN };
}

/** Where a problem shows on the form. */
export type FormPlace = 'asked' | 'method' | 'told' | 'given' | 'retention' | 'outcome' | 'confirm' | keyof ConsentGiven;

export interface FormIssue {
  place: FormPlace;
  message: string;
}

/** Problems that stop the form being saved at all: a record with them would be invalid. */
export function saveIssues(ws: CompanyWorkspace, sessionId: string, v: ConsentFormValues): FormIssue[] {
  const issues: FormIssue[] = [];
  for (const id of v.askedParticipantIds) {
    const p = get(ws.participants, id);
    if (!p || p.sessionId !== sessionId || p.side !== 'client')
      issues.push({ place: 'asked', message: 'Only the session’s client participants can be named as asked.' });
  }
  if (v.method.kind === 'other' && !isNonEmptyText(v.method.description))
    issues.push({ place: 'method', message: 'Describe how consent was asked.' });
  for (const i of toldIssues(v.told)) issues.push({ place: 'told', message: i.message });
  for (const i of termsIssues(v)) {
    const place: FormPlace =
      i.code === 'consent.limits'
        ? 'outcome'
        : i.code === 'consent.retention'
          ? 'retention'
          : i.code === 'consent.provider'
            ? 'aiExternal'
            : 'given';
    issues.push({ place, message: i.message });
  }
  return issues;
}

/** The answers that need each statement told, in the order the form shows them (CONSENT.md, rule C2). */
const ANSWERS: (keyof ConsentGiven)[] = ['audioRecording', 'transcription', 'aiLocal', 'aiExternal'];

/**
 * Problems that stop the form being confirmed (it can still be saved as a
 * draft): who was asked, who asked, and C2 next to each "yes".
 */
export function confirmIssues(v: ConsentFormValues, askedBy: string | null): FormIssue[] {
  const issues: FormIssue[] = [];
  if (!v.askedParticipantIds.length) issues.push({ place: 'asked', message: 'Tick who was asked.' });
  if (!isNonEmptyText(askedBy)) issues.push({ place: 'confirm', message: 'Give your name, as the person who asked.' });
  // Consent given (with or without limits) to nothing at all contradicts itself.
  if (v.outcome.kind !== 'declined' && !ANSWERS.some((a) => v.given[a]))
    issues.push({ place: 'given', message: 'Nothing is agreed: choose Declined, or set what they agreed to.' });
  const told: ToldSoFar = {
    statements: new Set(CONSENT_STATEMENTS.filter((s) => v.told[s])),
    providers: v.told.processingExternal && v.told.externalProvider ? [v.told.externalProvider] : [],
  };
  const alreadyNamed = new Set<ConsentStatement>();
  for (const answer of ANSWERS) {
    if (!v.given[answer]) continue;
    // Each "yes" lists what it still needs; "can stop or delete" is named once, on the first.
    const missing = missingFor(told, { ...NOTHING_GIVEN, [answer]: true, externalProvider: v.given.externalProvider }).filter(
      (s) => !alreadyNamed.has(s),
    );
    missing.forEach((s) => alreadyNamed.add(s));
    if (missing.length)
      issues.push({ place: answer, message: `Tick what you told them: ${missing.map(statementName).join(', ')}.` });
  }
  return issues;
}

/** A statement's short name, as the form's problems refer to it. */
export function statementName(s: ConsentStatement): string {
  return {
    recorded: 'recording the audio',
    transcribed: 'the transcript',
    aiExtraction: 'using AI',
    processingLocal: 'the AI running on this computer',
    processingExternal: 'the external AI provider',
    retention: 'how long the recording is kept',
    canStopOrDelete: 'stopping or deleting',
  }[s];
}

/**
 * Saves the form as the session's consent record, creating it the first
 * time. Changing what a confirmed record says clears its confirmation unless
 * the form confirms it again (rule C3); confirming records who and when. A
 * locked record (after a withdrawal) changes only by amendments.
 */
export function saveConsentForm(
  ws: CompanyWorkspace,
  sessionId: string,
  v: ConsentFormValues,
  askedBy: string | null,
  at: Timestamp,
): Result<CompanyWorkspace> {
  if (!get(ws.sessions, sessionId)) return fail('The session does not exist.');
  const blocking = saveIssues(ws, sessionId, v)[0];
  if (blocking) return fail(blocking.message);
  if (v.confirm) {
    const issue = confirmIssues(v, askedBy)[0];
    if (issue) return fail(issue.message);
  }
  const existing = consentFor(ws, sessionId);
  if (existing?.lockedAt) return fail('This consent record is locked. It changes only by amendments.');
  const fields = {
    askedParticipantIds: v.askedParticipantIds,
    // An existing record keeps who asked: re-saving it later, under another name in settings, mustn't rewrite that.
    askedBy: existing?.askedBy || askedBy?.trim() || '',
    method: v.method,
    told: v.told,
    given: v.given,
    retention: v.retention,
    outcome: v.outcome,
  };
  if (existing) {
    const changed = JSON.stringify(fields) !== JSON.stringify({ ...pick(existing), askedBy: fields.askedBy });
    const wasConfirmed = existing.confirmed !== null;
    if (!changed && wasConfirmed === v.confirm) return ok(ws);
    const confirmed = v.confirm ? (changed || !wasConfirmed ? { by: fields.askedBy, at } : existing.confirmed) : null;
    const record: ConsentRecord = {
      ...existing,
      ...fields,
      wordingVersion: changed ? CURRENT_WORDING : existing.wordingVersion,
      confirmed,
      updatedAt: at,
    };
    return ok({ ...ws, consents: { ...ws.consents, [record.id]: record } });
  }
  const id = createId(ID_PREFIX.consents);
  const record: ConsentRecord = {
    id,
    sessionId,
    ...fields,
    wordingVersion: CURRENT_WORDING,
    confirmed: v.confirm ? { by: fields.askedBy, at } : null,
    attachmentFileId: null,
    lockedAt: null,
    amendments: [],
    createdAt: at,
    updatedAt: at,
  };
  return ok({ ...ws, consents: { ...ws.consents, [id]: record } });
}

function pick(r: ConsentRecord) {
  const { askedParticipantIds, askedBy, method, told, given, retention, outcome } = r;
  return { askedParticipantIds, askedBy, method, told, given, retention, outcome };
}

/**
 * The client withdraws consent (rule C8): a dated amendment with the reason,
 * on any confirmed record, which locks it. Nothing more is captured or
 * processed for the session from then on.
 */
export function withdrawConsent(
  ws: CompanyWorkspace,
  sessionId: string,
  reason: string,
  by: string,
  at: Timestamp,
): Result<CompanyWorkspace> {
  const record = consentFor(ws, sessionId);
  if (!record) return fail('This session has no consent record.');
  if (!isNonEmptyText(by)) return fail('Give your name, as the person recording the withdrawal.');
  const amended = amendConsent(record, {
    id: createId(ID_PREFIX.amendment),
    kind: 'withdrawal',
    by: by.trim(),
    at,
    reason: reason.trim(),
  });
  if (!amended.ok) return amended;
  return ok({ ...ws, consents: { ...ws.consents, [record.id]: amended.value } });
}

/**
 * The Amend… form for a locked record (Phase 2 brief, decision 10): what the
 * record allows now, which the consultant changes, the statements newly told
 * in the current wording, and why.
 */
export interface AmendValues {
  /** Only the statements newly told; what the client heard before stays told. */
  told: ConsentTold;
  given: ConsentGiven;
  retention: Retention;
  outcome: ConsentOutcome;
  reason: string;
}

/** The Amend… form's starting values: the record as it stands, with nothing newly told. */
export function amendFormFor(record: ConsentRecord): AmendValues {
  const { given, retention, outcome } = consentState(record);
  return { told: NOTHING_TOLD, given, retention, outcome, reason: '' };
}

/** Whether a statement may be ticked on the Amend… form: one not told yet, or the retention in new words. */
export function canTellOnAmend(record: ConsentRecord, values: AmendValues, s: ConsentStatement): boolean {
  if (!toldSoFar(record).statements.has(s)) return true;
  const told = retentionTold(record, record.amendments.length);
  return s === 'retention' && values.given.audioRecording && told !== null && !sameJson(values.retention, told);
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The amendment the form describes: only what differs from the record as it stands. */
export function amendmentFrom(
  record: ConsentRecord,
  values: AmendValues,
  by: string,
  at: Timestamp,
): Result<Extract<ConsentAmendment, { kind: 'change' }>> {
  const current = consentState(record);
  const given: Partial<ConsentGiven> = {};
  for (const key of Object.keys(NOTHING_GIVEN) as (keyof ConsentGiven)[])
    if (values.given[key] !== current.given[key]) Object.assign(given, { [key]: values.given[key] });
  const told: Partial<ConsentTold> = {};
  for (const s of CONSENT_STATEMENTS) if (values.told[s]) told[s] = true;
  if (told.processingExternal) told.externalProvider = values.told.externalProvider;
  const amendment: Extract<ConsentAmendment, { kind: 'change' }> = {
    id: createId(ID_PREFIX.amendment),
    kind: 'change',
    by: by.trim(),
    at,
    reason: values.reason.trim(),
    ...(Object.keys(told).length > 0 && { told, wordingVersion: CURRENT_WORDING }),
    ...(Object.keys(given).length > 0 && { given }),
    ...(!sameJson(values.retention, current.retention) && { retention: values.retention }),
    ...(!sameJson(values.outcome, current.outcome) && { outcome: values.outcome }),
  };
  if (!amendment.told && !amendment.given && !amendment.retention && !amendment.outcome)
    return fail('Nothing has changed. Change an answer, or tick what you newly told them.');
  if (!isNonEmptyText(by)) return fail('Give your name, as the person recording the change.');
  return ok(amendment);
}

/**
 * Problems shown on the Amend… form as it is filled in, checked like the form
 * (rule C2): each "yes" against everything told so far, including what is
 * newly ticked, and a new retention told in its new words.
 */
export function amendIssues(record: ConsentRecord, values: AmendValues): FormIssue[] {
  const issues: FormIssue[] = [];
  for (const i of toldIssues(values.told)) issues.push({ place: 'told', message: i.message });
  for (const i of termsIssues(values))
    issues.push({
      place: i.code === 'consent.limits' ? 'outcome' : i.code === 'consent.retention' ? 'retention' : 'given',
      message: i.message,
    });
  const before = toldSoFar(record);
  const after = addTold(before, values.told);
  const current = consentState(record);
  const alreadyNamed = new Set<ConsentStatement>();
  for (const answer of ANSWERS) {
    if (!values.given[answer]) continue;
    const one = (given: ConsentGiven) => ({ ...NOTHING_GIVEN, [answer]: true, externalProvider: given.externalProvider });
    const missingBefore = new Set(missingFor(before, one(current.given)));
    const missing = missingFor(after, one(values.given)).filter(
      (s) => !alreadyNamed.has(s) && !(current.given[answer] && missingBefore.has(s)),
    );
    missing.forEach((s) => alreadyNamed.add(s));
    if (missing.length)
      issues.push({ place: answer, message: `Tick what you told them: ${missing.map(statementName).join(', ')}.` });
  }
  const retention = retentionToldIssue(record, record.amendments.length, {
    id: 'check',
    kind: 'change',
    by: '',
    at: record.updatedAt,
    reason: '',
    retention: values.retention,
    given: values.given,
    told: values.told.retention ? { retention: true } : undefined,
  });
  if (retention)
    issues.push({
      place: 'retention',
      message: 'The audio is now kept for a different time: tell them, and tick the statement in its new words.',
    });
  return issues;
}

/** Amends a locked consent record with the Amend… form (decision 10), checked as `amendConsent` does. */
export function amendConsentForm(
  ws: CompanyWorkspace,
  sessionId: string,
  values: AmendValues,
  by: string,
  at: Timestamp,
): Result<CompanyWorkspace> {
  const record = consentFor(ws, sessionId);
  if (!record) return fail('This session has no consent record.');
  const amendment = amendmentFrom(record, values, by, at);
  if (!amendment.ok) return amendment;
  const amended = amendConsent(record, amendment.value);
  if (!amended.ok) return amended;
  return ok({ ...ws, consents: { ...ws.consents, [record.id]: amended.value } });
}
