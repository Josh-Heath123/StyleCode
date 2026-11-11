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

describe('a client held open while the AI works on it (WP7)', () => {
  it('stays open while another is opened, and goes once the hold is let go and it has saved', async () => {
    const registry = new SessionRegistry();
    const a = client('co_a', { value: false });
    registry.open(a);
    const letGo = registry.hold(a);
    registry.open(client('co_b', { value: false }));
    expect(a.closed).toBe(false);
    expect(registry.get('co_a')).toBe(a);
    // The run adds its proposals to the held client, which saves them.
    a.apply('Add the AI’s proposals', rename('A'));
    letGo();
    expect(a.closed).toBe(false);
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(a.closed).toBe(true);
    expect(registry.get('co_a')).toBeUndefined();
  });

  it('stays open after the hold goes when it is the current client again', () => {
    const registry = new SessionRegistry();
    const a = client('co_a', { value: false });
    registry.open(a);
    const letGo = registry.hold(a);
    registry.open(client('co_b', { value: false }));
    registry.open(a);
    letGo();
    letGo();
    expect(a.closed).toBe(false);
    expect(registry.get('co_a')).toBe(a);
  });
});

describe('unfinished notes', () => {
  const draft = { text: 'Orders peak in Dec', startedAt: '2026-11-04T09:00:00.000Z' };

  it('keeps a session’s unfinished note until it is added or closed', () => {
    const registry = new SessionRegistry();
    registry.open(client('co_a', { value: false }));
    registry.setNoteDraft('co_a', 'se_1', draft);
    expect(registry.noteDraft('co_a', 'se_1')).toEqual(draft);
    expect(registry.noteDraft('co_a', 'se_2')).toBeUndefined();
    expect(registry.hasUnfinishedNotes()).toBe(true);
    registry.setNoteDraft('co_a', 'se_1', null);
    expect(registry.noteDraft('co_a', 'se_1')).toBeUndefined();
    expect(registry.hasUnfinishedNotes()).toBe(false);
  });

  it('keeps it while another client is open, and lets it go with its session or client', () => {
    const registry = new SessionRegistry();
    registry.open(client('co_a', { value: false }));
    registry.setNoteDraft('co_a', 'se_1', draft);
    registry.open(client('co_b', { value: false }));
    expect(registry.get('co_a')).toBeUndefined();
    expect(registry.noteDraft('co_a', 'se_1')).toEqual(draft);

    const a = client('co_a', { value: false });
    registry.open(a);
    a.apply('Delete the session', (ws) => {
      const { se_1: _gone, ...sessions } = ws.sessions;
      return { ...ws, sessions };
    });
    expect(registry.hasUnfinishedNotes()).toBe(false);

    registry.setNoteDraft('co_b', 'se_1', draft);
    registry.forgetNoteDrafts('co_b');
    expect(registry.noteDraft('co_b', 'se_1')).toBeUndefined();
  });
});
