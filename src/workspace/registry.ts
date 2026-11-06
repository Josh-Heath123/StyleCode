import type { WorkspaceSession } from './session.ts';

/**
 * The clients open in the browser, by id.
 *
 * - The client opened last (the current one) stays open while other pages
 *   show, including the design editor, so coming back finds its undo history
 *   as it was, the way the editor keeps its view.
 * - Any other client stays only while it has changes not yet saved, so its
 *   save keeps retrying, the warning before closing still covers it, and
 *   opening it again shows those changes rather than the older copy on disk.
 *   Opening it again before then calls off its release, so a save finishing
 *   later can never close the client being worked on.
 */
export class SessionRegistry {
  private readonly live = new Map<string, WorkspaceSession>();
  private readonly releasing = new Map<WorkspaceSession, () => void>();
  private current: WorkspaceSession | null = null;

  get(companyId: string): WorkspaceSession | undefined {
    return this.live.get(companyId);
  }

  all(): WorkspaceSession[] {
    return [...this.live.values()];
  }

  hasUnsavedWork(): boolean {
    return this.all().some((s) => s.hasUnsavedWork());
  }

  /** Makes a client the one kept open; the one open before it goes once it has saved. */
  open(session: WorkspaceSession): void {
    this.live.set(session.companyId, session);
    this.releasing.get(session)?.();
    const before = this.current;
    this.current = session;
    if (before && before !== session) this.release(before);
  }

  /** Closes a client straight away, dropping anything not saved: after it has been deleted, or to reload it. */
  close(companyId: string): void {
    const session = this.live.get(companyId);
    if (session) this.forget(session);
  }

  private forget(session: WorkspaceSession): void {
    this.releasing.get(session)?.();
    session.dispose();
    if (this.live.get(session.companyId) === session) this.live.delete(session.companyId);
    if (this.current === session) this.current = null;
  }

  private release(session: WorkspaceSession): void {
    const done = () => {
      if (this.current === session) return true; // Opened again meanwhile: it stays.
      if (session.hasUnsavedWork()) return false;
      this.forget(session);
      return true;
    };
    session.flush();
    if (done()) return;
    const unsubscribe = session.subscribe(() => {
      if (done()) stop();
    });
    const stop = () => {
      unsubscribe();
      this.releasing.delete(session);
    };
    this.releasing.set(session, stop);
  }
}
