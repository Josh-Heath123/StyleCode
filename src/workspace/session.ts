import { WorkspaceApiError, type OpenedCompany, type WorkspaceApi } from './api.ts';
import type { CompanyWorkspace } from './model/types.ts';
import type { Problem } from './model/validate.ts';

/**
 * One open client in the browser: its workspace, undo and redo (separate from
 * the editor's), and autosave to the local server, behaving like the editor's
 * project session: a short wait after a change, retries with backoff when the
 * server can't be reached, and a visible status.
 *
 * Every change is a pure function from `src/workspace/model`, applied as one
 * undoable step. A read-only client (one whose file has problems) takes no
 * changes at all.
 */

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error';

export interface WorkspaceSessionState {
  workspace: CompanyWorkspace;
  access: 'editable' | 'read-only';
  problems: Problem[];
  status: SaveStatus;
  /** Why the last save failed, while it is failing. */
  error: string | null;
  /** Whether trying the failed save again may work; a refusal (a stale revision, a taken name) won't. */
  retryable: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
}

interface Step {
  label: string;
  before: CompanyWorkspace;
  after: CompanyWorkspace;
}

export const SAVE_DELAY_MS = 500;
/** After a failed save that may work later, try again after these delays (the last one repeats), as the editor does. */
export const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000];
/** Steps kept for undo. Each is a whole workspace, but they share everything that didn't change. */
const MAX_UNDO = 200;

export class WorkspaceSession {
  private state: WorkspaceSessionState;
  private readonly listeners = new Set<() => void>();
  private undoStack: Step[] = [];
  private redoStack: Step[] = [];
  private revision: string;
  private lastSaved: CompanyWorkspace;
  /** The next save makes a permanent deletion (Phase 1 brief, decision 5). */
  private permanent = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retries = 0;
  private inFlight: Promise<void> | null = null;
  private disposed = false;

  constructor(
    readonly companyId: string,
    opened: OpenedCompany,
    private readonly api: WorkspaceApi,
  ) {
    this.revision = opened.revision;
    this.lastSaved = opened.workspace;
    this.state = {
      workspace: opened.workspace,
      access: opened.access,
      problems: opened.problems,
      status: 'saved',
      error: null,
      retryable: false,
      undoLabel: null,
      redoLabel: null,
    };
  }

  getState = (): WorkspaceSessionState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(partial: Partial<WorkspaceSessionState>): void {
    this.state = {
      ...this.state,
      ...partial,
      undoLabel: this.undoStack.at(-1)?.label ?? null,
      redoLabel: this.redoStack.at(-1)?.label ?? null,
    };
    this.listeners.forEach((l) => l());
  }

  get readOnly(): boolean {
    return this.state.access !== 'editable';
  }

  /** Whether this session has been closed (the client was deleted or reloaded): it takes no more changes. */
  get closed(): boolean {
    return this.disposed;
  }

  /** The workspace as last saved to disk. */
  get saved(): CompanyWorkspace {
    return this.lastSaved;
  }

  /**
   * Applies one change as an undoable step. Returns false, changing nothing,
   * when the client is read-only or the change made no difference. A
   * permanent deletion clears undo and redo (MVP Q6), and its save is marked
   * permanent so no previous copy keeps the deleted data. A final step (a
   * withdrawal of consent, rule C4) clears undo and redo too, but deletes
   * nothing, so its save keeps the previous copy as usual.
   */
  apply(
    label: string,
    change: (ws: CompanyWorkspace) => CompanyWorkspace,
    options: { permanent?: boolean; final?: boolean } = {},
  ): boolean {
    if (this.readOnly || this.disposed) return false;
    const before = this.state.workspace;
    const after = change(before);
    if (after === before) return false;
    if (options.permanent || options.final) {
      if (options.permanent) this.permanent = true;
      this.undoStack = [];
    } else {
      this.undoStack = [...this.undoStack, { label, before, after }].slice(-MAX_UNDO);
    }
    this.redoStack = [];
    this.changed(after);
    return true;
  }

  undo(): void {
    const step = this.undoStack.at(-1);
    if (!step || this.readOnly) return;
    this.undoStack = this.undoStack.slice(0, -1);
    this.redoStack = [...this.redoStack, step];
    this.changed(step.before);
  }

  redo(): void {
    const step = this.redoStack.at(-1);
    if (!step || this.readOnly) return;
    this.redoStack = this.redoStack.slice(0, -1);
    this.undoStack = [...this.undoStack, step];
    this.changed(step.after);
  }

  private changed(workspace: CompanyWorkspace): void {
    // While saves are failing, the status stays "Not saved" rather than flickering.
    this.set({ workspace, status: this.state.status === 'error' ? 'error' : 'pending' });
    this.schedule();
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.saveNow(), SAVE_DELAY_MS);
  }

  /** Whether closing the page now would lose changes. */
  hasUnsavedWork(): boolean {
    return this.state.workspace !== this.lastSaved || this.inFlight !== null;
  }

  /** Saves a waiting change now (when the page is hidden or closed). */
  flush = (): void => {
    if (this.timer) void this.saveNow();
  };

  /** Saves the current workspace, after any save already being written. */
  async saveNow(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    // One save at a time: whoever was also waiting may have started the next one.
    while (this.inFlight) await this.inFlight;
    if (this.disposed || this.state.workspace === this.lastSaved) {
      if (!this.disposed && this.state.status !== 'saved') this.set({ status: 'saved', error: null });
      return;
    }
    const write = this.write();
    this.inFlight = write;
    try {
      await write;
    } finally {
      this.inFlight = null;
      // Tell listeners once the save has fully finished: until now it still counted as unsaved work.
      if (!this.disposed) this.set({});
    }
  }

  private async write(): Promise<void> {
    const workspace = this.state.workspace;
    const permanent = this.permanent;
    if (this.state.status !== 'error') this.set({ status: 'saving' });
    try {
      const { revision } = await this.api.saveCompany(this.companyId, workspace, this.revision, permanent);
      this.revision = revision;
      this.lastSaved = workspace;
      if (permanent) this.permanent = false;
      this.retries = 0;
      if (this.disposed) return;
      // A newer change may have arrived while saving; its own save is already scheduled.
      this.set({ status: this.state.workspace === workspace ? 'saved' : 'pending', error: null });
    } catch (error) {
      const failure = error instanceof WorkspaceApiError ? error : new WorkspaceApiError(String(error), 0);
      if (this.disposed) return;
      this.set({ status: 'error', error: failure.message, retryable: failure.retryable });
      // A refusal (a stale revision, a name another client has, problems) won't change by itself:
      // the next change tries again. Anything else is retried with backoff.
      if (!failure.retryable) return;
      const delay = RETRY_DELAYS_MS[Math.min(this.retries, RETRY_DELAYS_MS.length - 1)];
      this.retries++;
      this.retryTimer = setTimeout(() => void this.saveNow(), delay);
    }
  }

  /** Tries a failed save again straight away. */
  retry(): Promise<void> {
    this.retries = 0;
    return this.saveNow();
  }

  /** Stops saving and retrying, when the client is closed or reloaded. */
  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.timer = null;
    this.retryTimer = null;
    this.listeners.clear();
  }
}
