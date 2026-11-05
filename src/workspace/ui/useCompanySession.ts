import { useEffect, useState } from 'react';
import { openCompany, saveCompany } from '../api';
import { WorkspaceSession } from '../session';

/**
 * Open clients, by id.
 *
 * - The client opened last stays open while other pages show, including the
 *   design editor, so coming back finds its undo history as it was, the way
 *   the editor keeps its view.
 * - Any other client stays only while it has changes not yet saved, so its
 *   save keeps retrying, the warning before closing still covers it, and
 *   opening it again shows those changes rather than the older copy on disk.
 */
const live = new Map<string, WorkspaceSession>();
let current: WorkspaceSession | null = null;

function hasUnsavedWork(): boolean {
  return [...live.values()].some((s) => s.hasUnsavedWork());
}

if (typeof window !== 'undefined') {
  const flushAll = () => live.forEach((s) => s.flush());
  window.addEventListener('pagehide', flushAll);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flushAll());
  window.addEventListener('beforeunload', (e) => {
    flushAll();
    if (!hasUnsavedWork()) return;
    e.preventDefault();
    e.returnValue = '';
  });
}

function forget(session: WorkspaceSession): void {
  session.dispose();
  if (live.get(session.companyId) === session) live.delete(session.companyId);
  if (current === session) current = null;
}

/** Closes a client's session once nothing is waiting to be saved. */
function release(session: WorkspaceSession): void {
  const done = () => {
    if (session.hasUnsavedWork()) return false;
    forget(session);
    return true;
  };
  session.flush();
  if (done()) return;
  const stop = session.subscribe(() => done() && stop());
}

/** Makes a client the one kept open; the one before it goes once it has saved. */
function makeCurrent(session: WorkspaceSession): void {
  if (current && current !== session) release(current);
  current = session;
}

/**
 * Saves what open clients have waiting, before reading clients from disk, so
 * a list shows the change just made rather than the copy from before it.
 */
export async function saveOpenClients(): Promise<void> {
  await Promise.all([...live.values()].map((s) => s.saveNow().catch(() => undefined)));
}

/** Closes a client straight away, dropping anything not saved: after it has been deleted. */
export function closeCompany(companyId: string): void {
  const session = live.get(companyId);
  if (session) forget(session);
}

export type CompanyLoad =
  { state: 'loading' } | { state: 'failed'; error: string; status: number } | { state: 'open'; session: WorkspaceSession };

/** Opens a client for its pages. */
export function useCompanySession(companyId: string): [CompanyLoad, reload: () => void] {
  const [load, setLoad] = useState<CompanyLoad>(() => {
    const open = live.get(companyId);
    return open ? { state: 'open', session: open } : { state: 'loading' };
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const open = live.get(companyId);
    if (open) {
      makeCurrent(open);
      setLoad({ state: 'open', session: open });
    } else {
      setLoad({ state: 'loading' });
      openCompany(companyId).then(
        (opened) => {
          if (cancelled) return;
          // Another page of the same client may have opened it meanwhile.
          const session = live.get(companyId) ?? new WorkspaceSession(companyId, opened, { saveCompany });
          live.set(companyId, session);
          makeCurrent(session);
          setLoad({ state: 'open', session });
        },
        (error: Error & { status?: number }) => {
          if (!cancelled) setLoad({ state: 'failed', error: error.message, status: error.status ?? 0 });
        },
      );
    }
    return () => {
      cancelled = true;
    };
  }, [companyId, attempt]);

  /** Drops this client's unsaved changes and opens it again from disk (after "changed in another window"). */
  const reload = () => {
    closeCompany(companyId);
    setAttempt((n) => n + 1);
  };
  return [load, reload];
}
