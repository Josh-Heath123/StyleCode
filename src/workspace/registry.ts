import type { Timestamp } from './model/types.ts';
import type { WorkspaceSession } from './session.ts';

/** A note being written and not yet added: its text, and when typing started (the note's time). */
export interface NoteDraft {
  text: string;
  startedAt: Timestamp;
}

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
 *
 * - A client the AI is working on (`hold`) stays open until the run lets it
 *   go, so the proposals can be added when it ends, wherever the consultant
 *   is in StyleCode by then.
 *
 * It also keeps each session's unfinished note, in memory only, so leaving a
 * session page and coming back finds the note as it was left.
 */
export class SessionRegistry {
  private readonly live = new Map<string, WorkspaceSession>();
  private readonly releasing = new Map<WorkspaceSession, () => void>();
  private current: WorkspaceSession | null = null;
  /** Told when a client is closed, before it is disposed: a run on it stops. */
  private readonly closeListeners = new Set<(session: WorkspaceSession) => void>();
  /** Clients held open, with how many holds each has. */
  private readonly holds = new Map<WorkspaceSession, number>();
  /** Unfinished notes by client, then by session. */
  private readonly drafts = new Map<string, Map<string, NoteDraft>>();

  get(companyId: string): WorkspaceSession | undefined {
    return this.live.get(companyId);
  }

  all(): WorkspaceSession[] {
    return [...this.live.values()];
  }

  hasUnsavedWork(): boolean {
    return this.all().some((s) => s.hasUnsavedWork());
  }

  noteDraft(companyId: string, sessionId: string): NoteDraft | undefined {
    return this.drafts.get(companyId)?.get(sessionId);
  }

  /** Keeps a session's unfinished note, or with `null` (the note was added or closed) lets it go. */
  setNoteDraft(companyId: string, sessionId: string, draft: NoteDraft | null): void {
    const company = this.drafts.get(companyId) ?? new Map<string, NoteDraft>();
    if (draft) company.set(sessionId, draft);
    else company.delete(sessionId);
    if (company.size) this.drafts.set(companyId, company);
    else this.drafts.delete(companyId);
  }

  /** Whether a note is being written somewhere and not yet added, so closing the page would lose it. */
  hasUnfinishedNotes(): boolean {
    for (const session of this.live.values()) this.dropDraftsOfDeletedSessions(session);
    return this.drafts.size > 0;
  }

  /** Lets a client's unfinished notes go: after the client has been deleted. */
  forgetNoteDrafts(companyId: string): void {
    this.drafts.delete(companyId);
  }

  /** A session deleted with its note unfinished takes the note with it. */
  private dropDraftsOfDeletedSessions(session: WorkspaceSession): void {
    const company = this.drafts.get(session.companyId);
    if (!company) return;
    const sessions = session.getState().workspace.sessions;
    for (const id of [...company.keys()]) if (!(id in sessions)) company.delete(id);
    if (!company.size) this.drafts.delete(session.companyId);
  }

  /** Keeps a client open, whichever client is opened meanwhile, until the hold returned is let go. */
  hold(session: WorkspaceSession): () => void {
    this.holds.set(session, (this.holds.get(session) ?? 0) + 1);
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      const left = (this.holds.get(session) ?? 1) - 1;
      if (left > 0) return void this.holds.set(session, left);
      this.holds.delete(session);
      // Let it go now, if it isn't the current client and is still open.
      if (this.current !== session && this.live.get(session.companyId) === session) {
        this.releasing.get(session)?.();
        this.release(session);
      }
    };
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

  /** Calls back whenever a client is closed (deleted, reloaded, or let go). Returns the way to stop. */
  onClose(listener: (session: WorkspaceSession) => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  private forget(session: WorkspaceSession): void {
    this.closeListeners.forEach((l) => l(session));
    this.releasing.get(session)?.();
    this.dropDraftsOfDeletedSessions(session);
    session.dispose();
    if (this.live.get(session.companyId) === session) this.live.delete(session.companyId);
    if (this.current === session) this.current = null;
  }

  private release(session: WorkspaceSession): void {
    const done = () => {
      if (this.current === session) return true; // Opened again meanwhile: it stays.
      if (this.holds.has(session)) return true; // Held: it stays, and is let go when the hold is.
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
