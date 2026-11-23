import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CompanySummary } from '../api';
import { listAll } from './PastTimeCard';

/**
 * The start-up list of recordings to deal with reads every client (Phase 3, decision 23). With many clients, reading
 * them one after another kept the list hidden for seconds; they are read a few at a time.
 */

afterEach(() => vi.unstubAllGlobals());

const summary = (i: number): CompanySummary =>
  ({ id: `co_${String(i).padStart(10, '0')}`, name: `Client ${i}`, access: 'editable' }) as unknown as CompanySummary;

describe('the start-up list reads clients a few at a time', () => {
  it('reads every client, never more than six at once, and more than one at a time', async () => {
    let inFlight = 0;
    let most = 0;
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        inFlight++;
        most = Math.max(most, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight--;
        // Not a client's file as the model expects: each client is left out, as a damaged one is.
        return new Response(JSON.stringify(url.endsWith('/transcriptions') ? { jobs: [] } : { workspace: {}, revision: 'x' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    const companies = Array.from({ length: 20 }, (_, i) => summary(i));
    expect(await listAll(companies, '2026-11-23T09:00:00.000Z')).toEqual({ due: [], waiting: [] });
    for (const c of companies) expect(urls.some((u) => u.endsWith(`/companies/${c.id}`))).toBe(true);
    expect(most).toBeGreaterThan(1);
    expect(most).toBeLessThanOrEqual(6);
  });

  it('leaves out a client that can’t be read, and an unreadable one isn’t asked for', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        return new Response('{"error":"no"}', { status: 500, headers: { 'content-type': 'application/json' } });
      }),
    );
    const unreadable = { ...summary(1), access: 'unreadable' } as CompanySummary;
    expect(await listAll([summary(0), unreadable])).toEqual({ due: [], waiting: [] });
    expect(urls.some((u) => u.includes(unreadable.id))).toBe(false);
  });
});
