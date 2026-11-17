import type { AiStop, CompanyWorkspace } from './types.ts';
import { fail, get, isNonEmptyText, isTimestamp, ok, type Result } from './util.ts';

/** Long enough for any reason a run gives; a reason is never the client's words. */
export const AI_STOP_REASON_MAX = 500;

/**
 * Keeps why the AI's run on a session stopped part-way (version 5), so the
 * session still says so later: after a reload, or the next day. Replaces an
 * earlier one; only the last stop is kept.
 */
export function noteAiStop(ws: CompanyWorkspace, sessionId: string, stop: AiStop): Result<CompanyWorkspace> {
  const session = get(ws.sessions, sessionId);
  if (!session) return fail('The session does not exist.');
  const reason = stop.reason.trim().slice(0, AI_STOP_REASON_MAX);
  if (!isNonEmptyText(reason) || !isTimestamp(stop.at) || !isNonEmptyText(stop.model))
    return fail('A stopped run needs when, why and which model.');
  if (!Number.isInteger(stop.parts) || !Number.isInteger(stop.partsDone) || stop.partsDone < 0 || stop.partsDone > stop.parts)
    return fail('A stopped run’s parts don’t add up.');
  return ok({ ...ws, sessions: { ...ws.sessions, [sessionId]: { ...session, aiStop: { ...stop, reason } } } });
}

/** Forgets a session's stopped run: a later run finished, or the consultant dismissed it. */
export function clearAiStop(ws: CompanyWorkspace, sessionId: string): Result<CompanyWorkspace> {
  const session = get(ws.sessions, sessionId);
  if (!session) return fail('The session does not exist.');
  if (session.aiStop === null) return ok(ws);
  return ok({ ...ws, sessions: { ...ws.sessions, [sessionId]: { ...session, aiStop: null } } });
}
