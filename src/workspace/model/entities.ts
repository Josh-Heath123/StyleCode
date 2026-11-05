/**
 * Engagements, sessions and participants (MVP stories 2.1 to 2.3). Every
 * function is pure and returns a new workspace (or the same one when nothing
 * changes), so the app can make each one an undoable step. Deleting an
 * engagement or a session is `removeEngagement` and `removeSession` in
 * `findings.ts`, which also clean up what rested on them.
 */
import { consentFor, consentState } from './consent.ts';
import type { CompanyWorkspace, Engagement, EngagementStatus, Participant, Session, Side, Timestamp } from './types.ts';
import { createId, fail, get, isCalendarDate, isTimestamp, ok, type Result } from './util.ts';
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
}

function sessionIssue(fields: Partial<SessionFields>): string | null {
  if (fields.title !== undefined && !fields.title.trim()) return 'Give the session a title.';
  if (fields.startsAt !== undefined && !isTimestamp(fields.startsAt)) return 'Give the date and time the session starts.';
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
  changes: Partial<SessionFields>,
  at: Timestamp,
): Result<CompanyWorkspace> {
  const session = get(ws.sessions, id);
  if (!session) return fail('The session does not exist.');
  const issue = sessionIssue(changes);
  if (issue) return fail(issue);
  const next: Session = {
    ...session,
    ...(changes.title !== undefined && { title: changes.title.trim() }),
    ...(changes.startsAt !== undefined && { startsAt: changes.startsAt }),
  };
  if (same(next, session)) return ok(ws);
  return ok({ ...ws, sessions: { ...ws.sessions, [id]: { ...next, updatedAt: at } } });
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
 * Whether the session's consent record names this participant as asked. Such
 * a participant can't be removed or moved to the consultant's side while the
 * record names them, or the record would no longer say who was asked.
 */
function askedForConsent(ws: CompanyWorkspace, participant: Participant): boolean {
  return consentFor(ws, participant.sessionId)?.askedParticipantIds.includes(participant.id) ?? false;
}

/** Changes a participant's name, role, organisation or side. */
export function editParticipant(ws: CompanyWorkspace, id: string, changes: Partial<ParticipantFields>): Result<CompanyWorkspace> {
  const participant = get(ws.participants, id);
  if (!participant) return fail('The participant does not exist.');
  const issue = participantIssue(changes);
  if (issue) return fail(issue);
  if (changes.side === 'consultant' && participant.side === 'client' && askedForConsent(ws, participant))
    return fail(`${participant.name} was asked for consent as the client. Change the consent form first.`);
  const next: Participant = {
    ...participant,
    ...(changes.name !== undefined && { name: changes.name.trim() }),
    ...(changes.role !== undefined && { role: changes.role.trim() }),
    ...(changes.organisation !== undefined && { organisation: changes.organisation.trim() }),
    ...(changes.side !== undefined && { side: changes.side }),
  };
  if (same(next, participant)) return ok(ws);
  return ok({ ...ws, participants: { ...ws.participants, [id]: next } });
}

/** Removes a participant, unless the session's consent record names them as asked. */
export function removeParticipant(ws: CompanyWorkspace, id: string): Result<CompanyWorkspace> {
  const participant = get(ws.participants, id);
  if (!participant) return fail('The participant does not exist.');
  if (askedForConsent(ws, participant))
    return fail(`${participant.name} is named on the consent form as asked. Change the consent form first.`);
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
