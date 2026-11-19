import { expect, type APIRequestContext } from '@playwright/test';

/**
 * This computer's one heavy slot (Phase 3, decision 10), as the tests that start heavy jobs see it.
 *
 * A page holds the slot for an AI run and lets it go when the run ends. If the page reloads or closes before its
 * "let go" reaches the server, the slot stays taken until the server stops waiting for the page (3 minutes), and
 * every heavy job after it waits. So a test makes sure the slot is free before it reloads mid-run, and again when it
 * ends: one that leaves the slot taken fails by name, instead of the tests after it.
 */
const HEADERS = { 'x-stylecode-workspace': '1' };

/** Whether the slot is free now: takes it and lets it go at once. */
export async function heavySlotFree(request: APIRequestContext): Promise<boolean> {
  const res = await request.post('/api/workspace/heavy', { headers: HEADERS, data: { kind: 'extraction' } });
  const lease = (await res.json()) as { id: string; state: 'running' | 'waiting' };
  await request.delete(`/api/workspace/heavy/${lease.id}`, { headers: HEADERS });
  return lease.state === 'running';
}

export async function expectHeavySlotFree(request: APIRequestContext): Promise<void> {
  await expect
    .poll(() => heavySlotFree(request), {
      timeout: 15_000,
      message: 'The heavy slot is still taken: a run or a transcription this test started hasn’t let it go.',
    })
    .toBe(true);
}
