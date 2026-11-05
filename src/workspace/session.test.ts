import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceApiError, type OpenedCompany } from './api';
import { sampleWorkspace } from './model/fixtures';
import type { CompanyWorkspace } from './model/types';
import { editCompany } from './model/workspace';
import { RETRY_DELAYS_MS, SAVE_DELAY_MS, WorkspaceSession } from './session';

const NOW = '2026-11-05T09:00:00.000Z';

/** A server that records saves, and fails the next ones with the errors queued in `failures`. */
function fakeServer() {
  const saves: { workspace: CompanyWorkspace; baseRevision: string; permanent: boolean }[] = [];
  const failures: WorkspaceApiError[] = [];
  let revision = 1;
  const api = {
    saveCompany: vi.fn(async (_id: string, workspace: CompanyWorkspace, baseRevision: string, permanent: boolean) => {
      const failure = failures.shift();
      if (failure) throw failure;
      saves.push({ workspace, baseRevision, permanent });
      return { revision: `r${++revision}` };
    }),
  };
  return { api, saves, failures };
}

function open(access: OpenedCompany['access'] = 'editable') {
  const server = fakeServer();
  const opened: OpenedCompany = { workspace: sampleWorkspace(), access, problems: [], revision: 'r1' };
  return { session: new WorkspaceSession('co_bakery', opened, server.api), ...server };
}

const rename = (name: string) => (ws: CompanyWorkspace) => {
  const result = editCompany(ws, { name }, NOW);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('changes and undo', () => {
  it('applies each change as one step, with its own undo and redo', () => {
    const { session } = open();
    expect(session.apply('Rename the client', rename('Harbour Bakeries'))).toBe(true);
    expect(session.getState()).toMatchObject({ undoLabel: 'Rename the client', redoLabel: null, status: 'pending' });
    session.undo();
    expect(session.getState().workspace.company.name).toBe('Harbour Bakery');
    expect(session.getState().redoLabel).toBe('Rename the client');
    session.redo();
    expect(session.getState().workspace.company.name).toBe('Harbour Bakeries');
  });

  it('records nothing when a change makes no difference', () => {
    const { session } = open();
    expect(session.apply('Rename the client', rename('Harbour Bakery'))).toBe(false);
    expect(session.getState()).toMatchObject({ undoLabel: null, status: 'saved' });
  });

  it('takes no changes while the client is read-only', () => {
    const { session } = open('read-only');
    expect(session.apply('Rename the client', rename('Other'))).toBe(false);
    expect(session.getState().workspace.company.name).toBe('Harbour Bakery');
  });

  it('clears undo and redo after a permanent deletion, and marks its save permanent', async () => {
    const { session, saves } = open();
    session.apply('Rename the client', rename('A'));
    session.undo();
    session.apply('Delete the engagement', (ws) => ({ ...ws, engagements: {} }), { permanent: true });
    expect(session.getState()).toMatchObject({ undoLabel: null, redoLabel: null });
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(saves.at(-1)?.permanent).toBe(true);
    session.apply('Rename the client', rename('B'));
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(saves.at(-1)?.permanent).toBe(false);
  });
});

describe('autosave', () => {
  it('saves a moment after the last change, on the revision it was based on', async () => {
    const { session, saves } = open();
    session.apply('Rename the client', rename('A'));
    session.apply('Rename the client', rename('B'));
    expect(saves).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(saves).toHaveLength(1);
    expect(saves[0]).toMatchObject({ baseRevision: 'r1', workspace: { company: { name: 'B' } } });
    expect(session.getState().status).toBe('saved');
    expect(session.hasUnsavedWork()).toBe(false);
    session.apply('Rename the client', rename('C'));
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(saves[1].baseRevision).toBe('r2');
  });

  it('retries with backoff when the server can’t be reached, and says so', async () => {
    const { session, saves, failures } = open();
    failures.push(new WorkspaceApiError('Unreachable.', 0), new WorkspaceApiError('Unreachable.', 0));
    session.apply('Rename the client', rename('A'));
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(session.getState()).toMatchObject({ status: 'error', error: 'Unreachable.' });
    expect(session.hasUnsavedWork()).toBe(true);
    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]);
    expect(saves).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[1]);
    expect(saves).toHaveLength(1);
    expect(session.getState()).toMatchObject({ status: 'saved', error: null });
  });

  it('doesn’t retry a refusal by itself, such as a client changed in another window', async () => {
    const { session, api, failures } = open();
    failures.push(new WorkspaceApiError('This client was changed in another window.', 409));
    session.apply('Rename the client', rename('A'));
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS + 60_000);
    expect(api.saveCompany).toHaveBeenCalledTimes(1);
    expect(session.getState()).toMatchObject({ status: 'error', error: 'This client was changed in another window.' });
  });

  it('writes one save at a time, and saves a change made during a save afterwards', async () => {
    const { session, saves, api } = open();
    let release: () => void = () => undefined;
    api.saveCompany.mockImplementationOnce(async (_id, workspace, baseRevision, permanent) => {
      await new Promise<void>((resolve) => (release = resolve));
      saves.push({ workspace, baseRevision, permanent });
      return { revision: 'r2' };
    });
    session.apply('Rename the client', rename('A'));
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    session.apply('Rename the client', rename('B'));
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(api.saveCompany).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(saves.map((s) => [s.workspace.company.name, s.baseRevision])).toEqual([
      ['A', 'r1'],
      ['B', 'r2'],
    ]);
    expect(session.getState().status).toBe('saved');
  });

  it('saves a waiting change straight away when flushed', async () => {
    const { session, saves } = open();
    session.apply('Rename the client', rename('A'));
    session.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(saves).toHaveLength(1);
  });
});
