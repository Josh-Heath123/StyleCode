import { isValidId } from '../model/ids.ts';

/**
 * Where the app is, as a hash route (Phase 1 brief: no router library), so
 * the browser's back button works and a page can be bookmarked.
 *
 *   #/                 the list of clients (the front door)
 *   #/c/<company>      a client
 *   #/settings         the consultant's settings
 *   #/editor           the design editor
 *
 * Engagements and sessions (`#/c/<company>/e/<engagement>/s/<session>`)
 * arrive with their pages in WP6.
 */
export type Route = { page: 'clients' } | { page: 'company'; companyId: string } | { page: 'settings' } | { page: 'editor' };

/** Reads a hash such as `#/c/co_123`. Anything unknown, or an id that isn't valid, is the clients list. */
export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts.length === 1 && parts[0] === 'editor') return { page: 'editor' };
  if (parts.length === 1 && parts[0] === 'settings') return { page: 'settings' };
  if (parts.length === 2 && parts[0] === 'c' && isValidId(parts[1])) return { page: 'company', companyId: parts[1] };
  return { page: 'clients' };
}

/** The hash for a route, for links. */
export function routeHref(route: Route): string {
  switch (route.page) {
    case 'clients':
      return '#/';
    case 'company':
      return `#/c/${route.companyId}`;
    case 'settings':
      return '#/settings';
    case 'editor':
      return '#/editor';
  }
}
