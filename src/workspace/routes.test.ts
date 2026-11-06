import { describe, expect, it } from 'vitest';
import { parseRoute, routeHref, type Route } from './routes';

describe('hash routes', () => {
  it('reads every page and writes it back', () => {
    const routes: Route[] = [
      { page: 'clients' },
      { page: 'company', companyId: 'co_abc123' },
      { page: 'engagement', companyId: 'co_abc123', engagementId: 'en_def456' },
      { page: 'session', companyId: 'co_abc123', engagementId: 'en_def456', sessionId: 'se_ghi789' },
      { page: 'consent', companyId: 'co_abc123', engagementId: 'en_def456', sessionId: 'se_ghi789' },
      { page: 'settings' },
      { page: 'editor' },
    ];
    for (const route of routes) expect(parseRoute(routeHref(route))).toEqual(route);
  });

  it('opens the clients list for anything it doesn’t know, including an invalid id', () => {
    for (const hash of [
      '',
      '#',
      '#/',
      '#/nowhere',
      '#/c/',
      '#/c/../../etc',
      '#/c/a b',
      '#/c/co_1/x/en_1',
      '#/c/co_1/e/',
      '#/c/co_1/e/en_1/s/../x',
      '#/c/co_1/e/en_1/s/se_1/more',
      '#/c/co_1/e/en_1/s/se_1/consent/x',
    ])
      expect(parseRoute(hash)).toEqual({ page: 'clients' });
  });
});
