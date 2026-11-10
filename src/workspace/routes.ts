import { isValidId } from '../model/ids.ts';

/**
 * Where the app is, as a hash route (Phase 1 brief: no router library), so
 * the browser's back button works and a page can be bookmarked.
 *
 *   #/                                  the list of clients (the front door)
 *   #/c/<company>                       a client
 *   #/c/<company>/e/<engagement>        an engagement
 *   #/c/<company>/e/<engagement>/record   its record of findings
 *   #/c/<company>/e/<engagement>/s/<session>   a session
 *   #/c/<company>/e/<engagement>/s/<session>/p/<passage>   a session, at a quoted segment or note
 *   #/c/<company>/e/<engagement>/s/<session>/consent   its consent form
 *   #/settings                          the consultant's settings
 *   #/editor                            the design editor
 */
export type Route =
  | { page: 'clients' }
  | { page: 'company'; companyId: string }
  | { page: 'engagement'; companyId: string; engagementId: string }
  | { page: 'record'; companyId: string; engagementId: string }
  | { page: 'session'; companyId: string; engagementId: string; sessionId: string; passageId?: string }
  | { page: 'consent'; companyId: string; engagementId: string; sessionId: string }
  | { page: 'settings' }
  | { page: 'editor' };

/** Reads a hash such as `#/c/co_123/e/en_456`. Anything unknown, or an id that isn't valid, is the clients list. */
export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts.length === 1 && parts[0] === 'editor') return { page: 'editor' };
  if (parts.length === 1 && parts[0] === 'settings') return { page: 'settings' };
  const [c, companyId, e, engagementId, s, sessionId, sub, passageId, ...rest] = parts;
  if (c !== 'c' || !isValidId(companyId) || rest.length) return { page: 'clients' };
  if (e === undefined) return { page: 'company', companyId };
  if (e !== 'e' || !isValidId(engagementId)) return { page: 'clients' };
  if (s === undefined) return { page: 'engagement', companyId, engagementId };
  if (s === 'record' && sessionId === undefined) return { page: 'record', companyId, engagementId };
  if (s !== 's' || !isValidId(sessionId)) return { page: 'clients' };
  if (sub === undefined) return { page: 'session', companyId, engagementId, sessionId };
  if (sub === 'consent' && passageId === undefined) return { page: 'consent', companyId, engagementId, sessionId };
  if (sub === 'p' && isValidId(passageId)) return { page: 'session', companyId, engagementId, sessionId, passageId };
  return { page: 'clients' };
}

/** The hash for a route, for links. */
export function routeHref(route: Route): string {
  switch (route.page) {
    case 'clients':
      return '#/';
    case 'company':
      return `#/c/${route.companyId}`;
    case 'engagement':
      return `#/c/${route.companyId}/e/${route.engagementId}`;
    case 'record':
      return `#/c/${route.companyId}/e/${route.engagementId}/record`;
    case 'session':
      return `#/c/${route.companyId}/e/${route.engagementId}/s/${route.sessionId}${route.passageId ? `/p/${route.passageId}` : ''}`;
    case 'consent':
      return `#/c/${route.companyId}/e/${route.engagementId}/s/${route.sessionId}/consent`;
    case 'settings':
      return '#/settings';
    case 'editor':
      return '#/editor';
  }
}
