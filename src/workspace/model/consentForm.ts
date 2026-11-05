/**
 * The consent form (MVP story 3.1; docs/spec/CONSENT.md): its values, what
 * stops it being saved or confirmed, and saving it as the session's consent
 * record. Pure, so saving is one undoable step.
 */
import { amendConsent, consentFor, missingFor, termsIssues, toldIssues, type ToldSoFar } from './consent.ts';
import {
  CONSENT_STATEMENTS,
  type CompanyWorkspace,
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
    askedBy: askedBy?.trim() ?? existing?.askedBy ?? '',
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
