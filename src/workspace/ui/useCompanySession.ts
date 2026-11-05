import { useEffect, useState } from 'react';
import { openCompany, saveCompany } from '../api';
import { WorkspaceSession } from '../session';

/**
 * Open clients, by id. A client stays here while it has changes not yet
 * saved, even after its page closes, so its save keeps retrying, the warning
 * before closing still covers it, and opening it again shows those changes
 * rather than the older copy on disk.
 */
const live = new Map<string, WorkspaceSession>();

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

/** Closes a client's session once nothing is waiting to be saved. */
function release(session: WorkspaceSession): void {
  const done = () => {
    if (session.hasUnsavedWork()) return false;
    session.dispose();
    if (live.get(session.companyId) === session) live.delete(session.companyId);
    return true;
  };
  session.flush();
  if (done()) return;
  const stop = session.subscribe(() => done() && stop());
}

export type CompanyLoad =
  { state: 'loading' } | { state: 'failed'; error: string; status: number } | { state: 'open'; session: WorkspaceSession };

/** Opens a client for its page, and lets it go when the page closes. */
export function useCompanySession(companyId: string): [CompanyLoad, reload: () => void] {
  const [load, setLoad] = useState<CompanyLoad>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let session: WorkspaceSession | null = live.get(companyId) ?? null;
    if (session) setLoad({ state: 'open', session });
    else {
      setLoad({ state: 'loading' });
      openCompany(companyId).then(
        (opened) => {
          if (cancelled) return;
          session = new WorkspaceSession(companyId, opened, { saveCompany });
          live.set(companyId, session);
          setLoad({ state: 'open', session });
        },
        (error: Error & { status?: number }) => {
          if (!cancelled) setLoad({ state: 'failed', error: error.message, status: error.status ?? 0 });
        },
      );
    }
    return () => {
      cancelled = true;
      if (session) release(session);
    };
  }, [companyId, attempt]);

  /** Drops this page's changes and opens the client again from disk (after "changed in another window"). */
  const reload = () => {
    const session = live.get(companyId);
    if (session) {
      session.dispose();
      live.delete(companyId);
    }
    setAttempt((n) => n + 1);
  };
  return [load, reload];
}
