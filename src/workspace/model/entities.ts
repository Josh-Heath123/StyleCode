/**
 * Engagements, sessions and participants (MVP stories 2.1 to 2.3). Every
 * function is pure and returns a new workspace (or the same one when nothing
 * changes), so the app can make each one an undoable step. Deleting an
 * engagement or a session is `removeEngagement` and `removeSession` in
 * `findings.ts`, which also clean up what rested on them.
 */
import { consentFor, consentState } from './consent.ts';
import type { CompanyWorkspace, Engagement, EngagementStatus, Participant, Session, Side, Timestamp } from './types.ts';
import { createId, currentTimeZone, fail, get, isCalendarDate, isTimeZone, isTimestamp, ok, type Result } from './util.ts';
import { ID_PREFIX } from './workspace.ts';

export interface EngagementFields {
  name: string;
  goal: string;
  status: EngagementStatus;
}

function engagementIssue(fields: Partial<EngagementFields>): string | null {
  if (fields.name !== undefined && !fields.name.trim()) return 'Give the engagement a name.';
  const status = fields.status;
  if (status && status.state === 'ended' && !isCalendarDate(status.endedOn)) return 'Give the date the engagement ended.';
  return null;
}

/** Adds an engagement to the company (MVP 2.1). */
export function createEngagement(
  ws: CompanyWorkspace,
  fields: EngagementFields,
  at: Timestamp,
): Result<{ workspace: CompanyWorkspace; id: string }> {
  const issue = engagementIssue(fields);
  if (issue) return fail(issue);
  const id = createId(ID_PREFIX.engagements);
  const engagement: Engagement = {
    id,
    companyId: ws.company.id,
    name: fields.name.trim(),
    goal: fields.goal.trim(),
    status: fields.status,
    createdAt: at,
    updatedAt: at,
  };
  return ok({ workspace: { ...ws, engagements: { ...ws.engagements, [id]: engagement } }, id });
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Changes an engagement's name, goal or status. An engagement can't move to another company. */
export function editEngagement(
  ws: CompanyWorkspace,
  id: string,
  changes: Partial<EngagementFields>,
  at: Timestamp,
): Result<CompanyWorkspace> {
  const engagement = get(ws.engagements, id);
  if (!engagement) return fail('The engagement does not exist.');
  const issue = engagementIssue(changes);
  if (issue) return fail(issue);
  const next: Engagement = {
    ...engagement,
    ...(changes.name !== undefined && { name: changes.name.trim() }),
    ...(changes.goal !== undefined && { goal: changes.goal }),
    ...(changes.status !== undefined && { status: changes.status }),
  };
  if (same(next, engagement)) return ok(ws);
  return ok({ ...ws, engagements: { ...ws.engagements, [id]: { ...next, updatedAt: at } } });
}

export interface SessionFields {
  title: string;
  startsAt: Timestamp;
  /** The IANA time zone the session is in; the computer's when not given (decision 18). */
  timeZone?: string;
}

function sessionIssue(fields: Partial<SessionFields>): string | null {
  if (fields.title !== undefined && !fields.title.trim()) return 'Give the session a title.';
  if (fields.startsAt !== undefined && !isTimestamp(fields.startsAt)) return 'Give the date and time the session starts.';
  if (fields.timeZone !== undefined && !isTimeZone(fields.timeZone)) return 'The time zone isn’t one StyleCode knows.';
  return null;
}

/** Adds a session (a meeting) to an engagement (MVP 2.2). */
export function createSession(
  ws: CompanyWorkspace,
  engagementId: string,
  fields: SessionFields,
  at: Timestamp,
): Result<{ workspace: CompanyWorkspace; id: string }> {
  if (!get(ws.engagements, engagementId)) return fail('The engagement does not exist.');
  const issue = sessionIssue(fields);
  if (issue) return fail(issue);
  const id = createId(ID_PREFIX.sessions);
  const session: Session = {
    id,
    engagementId,
    title: fields.title.trim(),
    startsAt: fields.startsAt,
    timeZone: fields.timeZone ?? currentTimeZone(),
    audioFileIds: [],
    createdAt: at,
    updatedAt: at,
  };
  return ok({ workspace: { ...ws, sessions: { ...ws.sessions, [id]: session } }, id });
}

/** Changes a session's title or start. */
export function editSession(
  ws: CompanyWorkspace,
  id: string,
  changes: Partial<Omit<SessionFields, 'timeZone'>>,
  at: Timestamp,
): Result<CompanyWorkspace> {
  const session = get(ws.sessions, id);
  if (!session) return fail('The session does not exist.');
  const issue = sessionIssue(changes);
  if (issue) return fail(issue);
  // The consent record takes its date and time from the session; a locked record changes only by amendments (C4).
  if (changes.startsAt !== undefined && changes.startsAt !== session.startsAt && consentFor(ws, id)?.lockedAt)
    return fail('The consent record for this session is locked, and it gives the session’s date and time, so they can’t change.');
  const next: Session = {
    ...session,
    ...(changes.title !== undefined && { title: changes.title.trim() }),
    ...(changes.startsAt !== undefined && { startsAt: changes.startsAt }),
  };
  if (same(next, session)) return ok(ws);
  const changed = { ...ws, sessions: { ...ws.sessions, [id]: { ...next, updatedAt: at } } };
  // The confirmation covers the session's date and time too (C3): changing them means confirming again.
  return ok(next.startsAt !== session.startsAt ? unconfirm(changed, id, at) : changed);
}

/**
 * Whether changing the session's date or time would clear its consent
 * record's confirmation (C3), so the app can warn before the change.
 */
export function sessionTimeClearsConfirmation(ws: CompanyWorkspace, sessionId: string): boolean {
  const record = consentFor(ws, sessionId);
  return !!record?.confirmed && !record.lockedAt;
}

/** Clears the confirmation of the session's consent record, if it is confirmed and not locked (C3). */
function unconfirm(ws: CompanyWorkspace, sessionId: string, at: Timestamp): CompanyWorkspace {
  const record = consentFor(ws, sessionId);
  if (!record?.confirmed || record.lockedAt) return ws;
  return { ...ws, consents: { ...ws.consents, [record.id]: { ...record, confirmed: null, updatedAt: at } } };
}

export interface ParticipantFields {
  name: string;
  role: string;
  organisation: string;
  side: Side;
}

function participantIssue(fields: Partial<ParticipantFields>): string | null {
  if (fields.name !== undefined && !fields.name.trim()) return 'Give the participant a name.';
  if (fields.side !== undefined && fields.side !== 'client' && fields.side !== 'consultant')
    return 'Choose the client’s side or yours.';
  return null;
}

/** Adds someone who took part in a session, on the client's side or the consultant's (MVP 2.2). */
export function addParticipant(
  ws: CompanyWorkspace,
  sessionId: string,
  fields: ParticipantFields,
): Result<{ workspace: CompanyWorkspace; id: string }> {
  if (!get(ws.sessions, sessionId)) return fail('The session does not exist.');
  const issue = participantIssue(fields);
  if (issue) return fail(issue);
  const id = createId(ID_PREFIX.participants);
  const participant: Participant = {
    id,
    sessionId,
    name: fields.name.trim(),
    role: fields.role.trim(),
    organisation: fields.organisation.trim(),
    side: fields.side,
    speakerLabels: [],
  };
  return ok({ workspace: { ...ws, participants: { ...ws.participants, [id]: participant } }, id });
}

/**
 * Why a participant the session's consent record names as asked can't be
 * removed or moved to the consultant's side (the record would no longer say
 * who was asked), with the way out; or null if the record doesn't name them.
 */
function namedOnConsent(ws: CompanyWorkspace, participant: Participant, action: string): string | null {
  const record = consentFor(ws, participant.sessionId);
  if (!record?.askedParticipantIds.includes(participant.id)) return null;
  if (record.lockedAt)
    return `${participant.name} is named on the consent record as asked, and the record can no longer be changed, so they stay.`;
  return `${participant.name} is named on the consent form as asked. To ${action}, untick them under “Who was asked” on the consent form first.`;
}

/** Changes a participant's name, role, organisation or side. */
export function editParticipant(
  ws: CompanyWorkspace,
  id: string,
  changes: Partial<ParticipantFields>,
  at: Timestamp,
): Result<CompanyWorkspace> {
  const participant = get(ws.participants, id);
  if (!participant) return fail('The participant does not exist.');
  const issue = participantIssue(changes);
  if (issue) return fail(issue);
  const named =
    changes.side === 'consultant' && participant.side === 'client' && namedOnConsent(ws, participant, 'move them to your side');
  if (named) return fail(named);
  // A locked record says who was asked by name, role and organisation; it changes only by amendments (C4).
  const record = consentFor(ws, participant.sessionId);
  const identity = changesIdentity(participant, changes);
  if (identity && record?.lockedAt && record.askedParticipantIds.includes(participant.id))
    return fail(
      `${participant.name} is named on the consent record as asked, and the record can no longer be changed, so their details stay.`,
    );
  const next: Participant = {
    ...participant,
    ...(changes.name !== undefined && { name: changes.name.trim() }),
    ...(changes.role !== undefined && { role: changes.role.trim() }),
    ...(changes.organisation !== undefined && { organisation: changes.organisation.trim() }),
    ...(changes.side !== undefined && { side: changes.side }),
  };
  if (same(next, participant)) return ok(ws);
  const changed = { ...ws, participants: { ...ws.participants, [id]: next } };
  // "I asked for consent as recorded above" covers who was asked (C3): changing them means confirming again.
  return ok(identity && record?.askedParticipantIds.includes(id) ? unconfirm(changed, participant.sessionId, at) : changed);
}

const changesIdentity = (p: Participant, changes: Partial<ParticipantFields>) =>
  (['name', 'role', 'organisation'] as const).some((k) => changes[k] !== undefined && changes[k].trim() !== p[k]);

/**
 * Whether these changes to a participant would clear the confirmation of
 * the consent record that names them as asked (C3), so the app can warn
 * before the change.
 */
export function participantChangeClearsConfirmation(
  ws: CompanyWorkspace,
  id: string,
  changes: Partial<ParticipantFields>,
): boolean {
  const participant = get(ws.participants, id);
  if (!participant || !changesIdentity(participant, changes)) return false;
  const record = consentFor(ws, participant.sessionId);
  return !!record?.confirmed && !record.lockedAt && record.askedParticipantIds.includes(id);
}

/** Removes a participant, unless the session's consent record names them as asked. */
export function removeParticipant(ws: CompanyWorkspace, id: string): Result<CompanyWorkspace> {
  const participant = get(ws.participants, id);
  if (!participant) return fail('The participant does not exist.');
  const named = namedOnConsent(ws, participant, 'remove them');
  if (named) return fail(named);
  const participants = { ...ws.participants };
  delete participants[id];
  return { ok: true, value: { ...ws, participants } };
}

/** A session's consent, in a word or two, for lists (MVP 2.2). */
export type ConsentSummary = 'not filled in' | 'not confirmed' | 'given' | 'given with limits' | 'declined' | 'withdrawn';

export function consentSummary(ws: CompanyWorkspace, sessionId: string): ConsentSummary {
  const record = consentFor(ws, sessionId);
  if (!record) return 'not filled in';
  if (!record.confirmed) return 'not confirmed';
  const state = consentState(record);
  if (state.withdrawn) return 'withdrawn';
  return state.outcome.kind === 'declined' ? 'declined' : state.outcome.kind === 'limited' ? 'given with limits' : 'given';
}
