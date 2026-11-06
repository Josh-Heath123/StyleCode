import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceApiError, type OpenedCompany } from './api';
import { sampleWorkspace } from './model/fixtures';
import type { CompanyWorkspace } from './model/types';
import { SessionRegistry } from './registry';
import { RETRY_DELAYS_MS, SAVE_DELAY_MS, WorkspaceSession } from './session';

/** A session whose saves fail while `down.value` is true, as when the local server can't be reached. */
function client(id: string, down: { value: boolean }) {
  const opened: OpenedCompany = { workspace: sampleWorkspace(), access: 'editable', problems: [], revision: 'r1' };
  let revision = 1;
  return new WorkspaceSession(id, opened, {
    saveCompany: vi.fn(async () => {
      if (down.value) throw new WorkspaceApiError('Unreachable.', 0);
      return { revision: `r${++revision}` };
    }),
  });
}
const rename = (name: string) => (ws: CompanyWorkspace) => ({ ...ws, company: { ...ws.company, name } });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('which clients stay open', () => {
  it('lets a client go once another is opened and it has saved', async () => {
    const registry = new SessionRegistry();
    const a = client('co_a', { value: false });
    registry.open(a);
    registry.open(client('co_b', { value: false }));
    expect(a.closed).toBe(true);
    expect(registry.get('co_a')).toBeUndefined();
  });

  it('keeps a client with a failing save open until it saves, then lets it go', async () => {
    const down = { value: true };
    const registry = new SessionRegistry();
    const a = client('co_a', down);
    registry.open(a);
    a.apply('Rename', rename('A'));
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    registry.open(client('co_b', { value: false }));
    expect(a.closed).toBe(false);
    down.value = false;
    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]);
    expect(a.closed).toBe(true);
  });

  it('never closes a client that was opened again before its save finished (review, finding 1)', async () => {
    const down = { value: true };
    const registry = new SessionRegistry();
    const a = client('co_a', down);
    registry.open(a);
    a.apply('Rename', rename('A'));
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    registry.open(client('co_b', { value: false }));
    registry.open(a); // Back to A while its save is still failing.
    down.value = false;
    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]);
    expect(a.closed).toBe(false);
    expect(a.getState().status).toBe('saved');
    // It still takes changes.
    expect(a.apply('Rename', rename('A again'))).toBe(true);
  });

  it('closes a client straight away when asked (after it is deleted)', () => {
    const registry = new SessionRegistry();
    const a = client('co_a', { value: false });
    registry.open(a);
    registry.close('co_a');
    expect(a.closed).toBe(true);
    expect(registry.get('co_a')).toBeUndefined();
  });
});
