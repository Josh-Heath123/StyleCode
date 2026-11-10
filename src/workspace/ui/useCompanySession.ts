import { useEffect, useState } from 'react';
import { openCompany, saveCompany } from '../api';
import { SessionRegistry, type NoteDraft } from '../registry';
import { WorkspaceSession } from '../session';

/** The clients open in this tab (`SessionRegistry` says which stay open, and for how long). */
const registry = new SessionRegistry();

if (typeof window !== 'undefined') {
  const flushAll = () => registry.all().forEach((s) => s.flush());
  window.addEventListener('pagehide', flushAll);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flushAll());
  window.addEventListener('beforeunload', (e) => {
    flushAll();
    if (!registry.hasUnsavedWork() && !registry.hasUnfinishedNotes()) return;
    e.preventDefault();
    e.returnValue = '';
  });
}

/**
 * Saves what open clients have waiting, before reading clients from disk, so
 * a list shows the change just made rather than the copy from before it.
 */
export async function saveOpenClients(): Promise<void> {
  await Promise.all(registry.all().map((s) => s.saveNow().catch(() => undefined)));
}

/** Closes a client straight away, dropping anything not saved: after it has been deleted. */
export function closeCompany(companyId: string): void {
  registry.close(companyId);
  registry.forgetNoteDrafts(companyId);
}

/** A session's unfinished note, kept while this tab is open. */
export function noteDraft(companyId: string, sessionId: string): NoteDraft | undefined {
  return registry.noteDraft(companyId, sessionId);
}

/** Keeps a session's unfinished note, or with `null` (the note was added or closed) lets it go. */
export function setNoteDraft(companyId: string, sessionId: string, draft: NoteDraft | null): void {
  registry.setNoteDraft(companyId, sessionId, draft);
}

export type CompanyLoad =
  { state: 'loading' } | { state: 'failed'; error: string; status: number } | { state: 'open'; session: WorkspaceSession };

/** Opens a client for its pages. */
export function useCompanySession(companyId: string): [CompanyLoad, reload: () => void] {
  const [load, setLoad] = useState<CompanyLoad>(() => {
    const open = registry.get(companyId);
    return open ? { state: 'open', session: open } : { state: 'loading' };
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const open = registry.get(companyId);
    if (open) {
      registry.open(open);
      setLoad({ state: 'open', session: open });
    } else {
      setLoad({ state: 'loading' });
      openCompany(companyId).then(
        (opened) => {
          if (cancelled) return;
          // Another page of the same client may have opened it meanwhile.
          const session = registry.get(companyId) ?? new WorkspaceSession(companyId, opened, { saveCompany });
          registry.open(session);
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
    registry.close(companyId);
    setAttempt((n) => n + 1);
  };
  return [load, reload];
}
