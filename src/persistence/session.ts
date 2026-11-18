import type { Camera } from '../editor/camera';
import type { Editor } from '../editor/editor';
import { createNode } from '../model/defaults';
import { createDocument } from '../model/document';
import { createId } from '../model/ids';
import { applyOps } from '../model/ops';
import { parseProject, referencedAssets, toProjectFile, type ProjectFile } from '../model/serialize';
import { BROWSER_ASSETS, exportAssets, importAssets, setAssetSource, type AssetSource } from './assets';
import type { DesignDocument } from '../model/types';
import { createExampleDocument } from './examples';
import { exportProjectFile, pickProjectFile, saveFile } from './files';
import { idbDelete, idbGet, idbGetAll, idbPut, PROJECTS } from './idb';

/**
 * Local-first project storage. The open project autosaves to IndexedDB a
 * moment after every change; projects can also be saved to and opened from
 * files. There is no account and no server.
 */

interface ProjectRecord {
  id: string;
  name: string;
  updatedAt: number;
  camera?: Camera;
  file: ProjectFile;
}

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
  /** Why the project can't be opened, when its stored data is damaged or from a newer StyleCode. */
  problem?: string;
}

export interface StorageUsage {
  usage: number;
  quota: number;
}

export type SaveStatus = 'saved' | 'saving' | 'pending' | 'error' | 'unavailable';

/**
 * An engagement's design, kept in its client's folder rather than in this
 * browser (ADR-0007; Phase 4, decision 4): the second place a design can
 * live. The workspace supplies it; the session saves through it with the
 * editor's usual autosave, and never writes its document to IndexedDB.
 */
export interface CompanyDesignTarget {
  /** The document it holds: only this document is ever saved through it. */
  readonly documentId: string;
  /** Saves the file over the revision it last read or wrote. Throws a `DesignSaveError` when it can't. */
  save(file: ProjectFile): Promise<void>;
  /** After a save: the workspace keeps the design's name in step with the document's (decision 5). */
  onSaved?(doc: DesignDocument): void;
  /** Where its images live while it is open. */
  readonly assets: AssetSource;
  /** Called once the editor no longer holds it, however it was closed. */
  onClosed?: () => void;
}

/** Why a company design wasn't saved, and whether trying again later may work. */
export class DesignSaveError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export interface SessionState {
  status: SaveStatus;
  error: string | null;
}

const LAST_PROJECT_KEY = 'stylecode:last-project';
const SAVE_DELAY_MS = 500;
/** After a failed save, try again after these delays (the last one repeats). */
const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000];
/** Warn once a session when the browser's storage for StyleCode is this full. */
const NEARLY_FULL = 0.9;

function readLastProjectId(): string | null {
  try {
    return localStorage.getItem(LAST_PROJECT_KEY);
  } catch {
    return null;
  }
}

function writeLastProjectId(id: string): void {
  try {
    localStorage.setItem(LAST_PROJECT_KEY, id);
  } catch {
    // Remembering the last project is a convenience only.
  }
}

/** A new project starts with one desktop frame so there is somewhere to draw. */
export function createStarterDocument(name = 'Untitled'): DesignDocument {
  const doc = createDocument(name);
  const frame = createNode('frame', { name: 'Desktop', x: 0, y: 0, width: 1440, height: 900 });
  return applyOps(doc, [{ type: 'create', parentId: doc.rootId, index: 0, nodes: [frame] }]).doc;
}

export class ProjectSession {
  private state: SessionState = { status: 'saved', error: null };
  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastSavedDoc: DesignDocument | null = null;
  private lastCamera: Camera | null = null;
  private storageAvailable = true;
  /** Whether what is open can be saved: an engagement's design saves to its client's folder whatever this browser allows. */
  private get canSave(): boolean {
    return this.storageAvailable || this.company !== null;
  }
  private unsubscribe: (() => void) | null = null;
  private readonly channel: BroadcastChannel | null;
  private readonly tabId = createId('tab');
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retries = 0;
  private warnedNearlyFull = false;
  /** The document as it was opened, to tell whether there is unsaved work when storage is unavailable. */
  private openedDoc: DesignDocument | null = null;
  /** The last save failed and retries are under way. */
  private failing = false;
  /** The save being written, if one is. */
  private inFlight: Promise<void> | null = null;
  /** Autosave is paused (while the recovery screen shows a design that may be broken). */
  private paused = false;
  /** The document and camera the autosave last looked at, so only real changes trigger a save. */
  private seen: { doc: DesignDocument | null; camera: Camera | null } = { doc: null, camera: null };
  /** The engagement's design open now, kept in its client's folder; null for the editor's own designs, in this browser. */
  private company: CompanyDesignTarget | null = null;
  /** Every company document opened in this tab: none is ever written to IndexedDB (decision 4). */
  private readonly companyDocs = new Set<string>();
  /** A refused save (another tab saved first, or the design is gone): not retried. */
  private refused = false;
  /** Counts company designs opened, so a leave that was waiting doesn't undo an open that came after it. */
  private opened = 0;

  /**
   * Asked before replacing a design whose latest changes couldn't be saved.
   * Returns true to go ahead and lose them.
   */
  confirmDiscard: (name: string) => boolean = (name) =>
    typeof window !== 'undefined' &&
    window.confirm(`The latest changes to “${name}” couldn’t be saved. Continue anyway and lose them?`);

  constructor(private readonly editor: Editor) {
    this.channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('stylecode') : null;
    this.channel?.addEventListener('message', (e: MessageEvent<{ id: string; tab: string }>) => {
      if (e.data?.tab !== this.tabId && e.data?.id === this.editor.getState().doc.id) {
        this.editor.notify('This design is also open in another tab. The tab that saves last wins.', 'error');
      }
    });
  }

  getState = (): SessionState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(partial: Partial<SessionState>): void {
    this.state = { ...this.state, ...partial };
    this.listeners.forEach((l) => l());
  }

  /**
   * Opens the most recent project that can be opened, or creates a starter
   * project. A project whose stored data is damaged is left untouched (its data
   * can still be downloaded from Projects) and the next one is opened instead.
   * Returns the opened project's saved camera, if any.
   */
  async init(): Promise<Camera | null> {
    let camera: Camera | null = null;
    let records: ProjectRecord[];
    try {
      records = await idbGetAll<ProjectRecord>(PROJECTS);
    } catch (error) {
      // No storage at all (blocked, private mode in some browsers): work in memory and say so.
      this.storageAvailable = false;
      this.editor.loadDocument(createStarterDocument());
      this.set({ status: 'unavailable', error: (error as Error).message });
      this.start();
      return null;
    }

    const lastId = readLastProjectId();
    const ordered = [...records].sort(
      (a, b) => Number(b.id === lastId) - Number(a.id === lastId) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
    );
    const skipped: string[] = [];
    for (const record of ordered) {
      const doc = this.tryLoad(record);
      if (doc) {
        camera = record.camera ?? null;
        this.lastSavedDoc = doc;
        break;
      }
      skipped.push(record.name || 'Untitled');
    }
    if (!this.lastSavedDoc) {
      this.editor.loadDocument(createStarterDocument());
      await this.saveNow();
    }
    writeLastProjectId(this.editor.getState().doc.id);
    if (skipped.length) {
      this.editor.notify(
        skipped.length === 1
          ? `“${skipped[0]}” couldn’t be opened. It’s still in Designs, where you can download its data.`
          : `${skipped.length} designs couldn’t be opened. They’re still in Designs, where you can download their data.`,
        'error',
      );
    }
    this.start();
    return camera;
  }

  /** Loads a stored project into the editor, or returns null if its data can't be read. */
  private tryLoad(record: ProjectRecord): DesignDocument | null {
    try {
      const parsed = parseProject(record.file);
      if (!parsed.ok) return null;
      this.editor.loadDocument(parsed.doc);
      return this.editor.committedDoc;
    } catch (error) {
      console.error('StyleCode: could not load a stored project', error);
      return null;
    }
  }

  private start(): void {
    this.unsubscribe?.();
    this.openedDoc = this.editor.committedDoc;
    this.lastCamera = this.editor.getState().camera;
    this.seen = { doc: this.editor.getState().doc, camera: this.lastCamera };
    this.unsubscribe = this.editor.subscribe(() => {
      const { doc, camera, gesturing, proposal } = this.editor.getState();
      // Drags and AI proposals under review aren't saved until they are done.
      if (gesturing || proposal || this.paused) return;
      // Only an edit or a camera move schedules a save; hovering, notices and the like don't,
      // so they can't keep postponing a save or cut short the wait between retries.
      if (doc === this.seen.doc && camera === this.seen.camera) return;
      this.seen = { doc, camera };
      const docChanged = doc !== this.lastSavedDoc;
      const cameraChanged = camera !== this.lastCamera;
      if (!docChanged && !cameraChanged) return;
      if (docChanged && this.canSave && !this.failing) this.set({ status: 'pending' });
      this.schedule();
    });
    window.addEventListener('pagehide', this.flush);
    window.addEventListener('beforeunload', this.onBeforeUnload);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  /** Whether closing the page now would lose work. */
  hasUnsavedWork(): boolean {
    if (this.paused) return false;
    if (!this.canSave) return this.editor.committedDoc !== this.openedDoc;
    return (
      this.timer !== null || this.state.status === 'saving' || this.state.status === 'pending' || this.state.status === 'error'
    );
  }

  /** Asks the browser to confirm leaving while a save is pending or has failed. */
  private onBeforeUnload = (e: BeforeUnloadEvent) => {
    this.flush();
    if (!this.hasUnsavedWork()) return;
    e.preventDefault();
    // Older browsers need returnValue set as well.
    e.returnValue = '';
  };

  private onVisibility = () => {
    if (document.visibilityState === 'hidden') this.flush();
  };

  private schedule(): void {
    if (!this.canSave) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.saveNow(), SAVE_DELAY_MS);
  }

  flush = (): void => {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
      if (!this.paused) void this.saveNow();
    }
  };

  /**
   * Stops autosaving, so a design the editor failed to draw doesn't replace
   * the last good save. Saving to a file still works.
   */
  pause(): void {
    this.paused = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.timer = null;
    this.retryTimer = null;
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.seen = { doc: null, camera: null };
    this.schedule();
  }

  async saveNow(): Promise<void> {
    const write = this.write();
    this.inFlight = write;
    try {
      await write;
    } finally {
      if (this.inFlight === write) this.inFlight = null;
    }
  }

  private async write(): Promise<void> {
    if (this.company) return this.writeCompany(this.company);
    if (!this.storageAvailable || this.paused) return;
    // A client's design never reaches this browser's storage, whatever is loaded (decision 4).
    if (this.companyDocs.has(this.editor.committedDoc.id)) return;
    // This save covers any that was waiting.
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    const { camera } = this.editor.getState();
    const doc = this.editor.committedDoc;
    const record: ProjectRecord = { id: doc.id, name: doc.name, updatedAt: Date.now(), camera, file: toProjectFile(doc) };
    const docChanged = doc !== this.lastSavedDoc;
    // While retrying, the status stays "Not saved" rather than flickering through "Saving…".
    if (docChanged && !this.failing) this.set({ status: 'saving' });
    try {
      await idbPut(PROJECTS, record);
      this.lastSavedDoc = doc;
      this.lastCamera = camera;
      if (docChanged) this.channel?.postMessage({ id: doc.id, tab: this.tabId });
      this.failing = false;
      this.retries = 0;
      // A newer change may have arrived while saving.
      if (this.editor.committedDoc === doc) this.set({ status: 'saved', error: null });
      else this.set({ status: 'pending', error: null });
      if (docChanged) void this.checkSpace();
    } catch (error) {
      const message = isQuotaError(error)
        ? 'Browser storage is full. Save the design to a file, or delete old designs to make room.'
        : `Couldn’t save: ${(error as Error)?.message ?? 'unknown error'}.`;
      // Said once when saving starts failing; the save status keeps showing it while retries carry on quietly.
      if (!this.failing) this.editor.notify(message, 'error');
      this.failing = true;
      this.set({ status: 'error', error: message });
      if (this.paused) return;
      const delay = RETRY_DELAYS_MS[Math.min(this.retries, RETRY_DELAYS_MS.length - 1)];
      this.retries++;
      this.retryTimer = setTimeout(() => void this.saveNow(), delay);
    }
  }

  /**
   * Saves an engagement's design through the workspace (decision 4), with the
   * editor's usual status and retries. Only its own document goes through it;
   * the view isn't saved, since a client's file holds the design alone. A
   * refusal (another tab saved first, the design or client is gone, or the
   * client is read-only) isn't retried: the tab says why.
   */
  private async writeCompany(target: CompanyDesignTarget): Promise<void> {
    if (this.paused || this.refused) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    const doc = this.editor.committedDoc;
    this.lastCamera = this.editor.getState().camera;
    if (doc.id !== target.documentId) return;
    if (doc === this.lastSavedDoc) return;
    if (!this.failing) this.set({ status: 'saving' });
    try {
      await target.save(toProjectFile(doc));
      // The design may have been closed meanwhile; what was saved is still its own.
      if (this.company !== target) return;
      this.lastSavedDoc = doc;
      this.failing = false;
      this.retries = 0;
      target.onSaved?.(doc);
      if (this.editor.committedDoc === doc) this.set({ status: 'saved', error: null });
      else this.set({ status: 'pending', error: null });
    } catch (error) {
      if (this.company !== target) return;
      const message = (error as Error)?.message || 'Couldn’t save the design.';
      if (!this.failing) this.editor.notify(message, 'error');
      this.failing = true;
      this.set({ status: 'error', error: message });
      if (error instanceof DesignSaveError && !error.retryable) {
        this.refused = true;
        return;
      }
      if (this.paused) return;
      const delay = RETRY_DELAYS_MS[Math.min(this.retries, RETRY_DELAYS_MS.length - 1)];
      this.retries++;
      this.retryTimer = setTimeout(() => void this.saveNow(), delay);
    }
  }

  /** The engagement's design open now, if one is. */
  companyDesign(): string | null {
    return this.company?.documentId ?? null;
  }

  /**
   * Opens an engagement's design (decision 4), after the usual check that
   * nothing unsaved would be lost. From then on it saves through `target`, and
   * images come from its client's folder.
   */
  async openCompanyDesign(target: CompanyDesignTarget, doc: DesignDocument): Promise<void> {
    if (doc.id !== target.documentId) throw new Error('The design file is for another document.');
    if (!(await this.mayReplace())) throw new KeptOpenError(this.canSave);
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.companyDocs.add(doc.id);
    this.opened++;
    const replaced = this.company;
    this.company = target;
    if (replaced && replaced !== target) replaced.onClosed?.();
    this.refused = false;
    setAssetSource(target.assets);
    this.editor.loadDocument(doc);
    this.replaced();
    this.lastSavedDoc = this.editor.committedDoc;
    this.set({ status: 'saved', error: null });
  }

  /**
   * Back to the editor's own designs: reopens the last one this browser kept,
   * or starts a new one. With `discard`, the company design's unsaved changes
   * go without asking, because its client or engagement was deleted (decision
   * 4), and the editor says `why`.
   */
  async leaveCompanyDesign(discard = false, why?: string): Promise<Camera | null> {
    if (!this.company) return null;
    if (!discard && !(await this.mayReplace())) throw new KeptOpenError(this.canSave);
    this.dropCompany();
    if (why) this.editor.notify(why, 'error');
    const opened = this.opened;
    const records = await idbGetAll<ProjectRecord>(PROJECTS).catch(() => null);
    // Another engagement's design opened meanwhile: it stays.
    if (this.opened !== opened) return null;
    const lastId = readLastProjectId();
    const usable = (records ?? [])
      .filter((r) => !this.companyDocs.has(r.id) && parseProject(r.file).ok)
      .sort((a, b) => Number(b.id === lastId) - Number(a.id === lastId) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    if (usable[0]) return this.openProject(usable[0].id);
    return this.newProject();
  }

  /** Stops saving the company design, whatever is unsaved, and turns images back to this browser's store. */
  private dropCompany(): void {
    const closed = this.company;
    if (this.timer) clearTimeout(this.timer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.timer = null;
    this.retryTimer = null;
    this.company = null;
    this.refused = false;
    this.failing = false;
    this.retries = 0;
    setAssetSource(BROWSER_ASSETS);
    this.set({ status: 'saved', error: null });
    closed?.onClosed?.();
  }

  /** Tries a failed save again straight away. */
  retry(): Promise<void> {
    this.refused = false;
    this.retries = 0;
    return this.saveNow();
  }

  /**
   * Before another design replaces this one: true if nothing would be lost,
   * or the user agreed to lose the changes that couldn't be saved.
   */
  private async mayReplace(): Promise<boolean> {
    // Finish a save that is waiting first: whether it works decides whether anything would be lost.
    if (this.timer && !this.paused) await this.saveNow();
    else if (this.inFlight) await this.inFlight;
    const unsaved = this.canSave ? this.failing : this.editor.committedDoc !== this.openedDoc;
    if (unsaved && !this.confirmDiscard(this.editor.committedDoc.name)) return false;
    // Whatever was failing belonged to the design being replaced.
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.failing = false;
    this.retries = 0;
    return true;
  }

  /** After another design is loaded: it is the baseline for what counts as unsaved. */
  private replaced(): void {
    this.openedDoc = this.editor.committedDoc;
    this.seen = { doc: this.editor.getState().doc, camera: this.editor.getState().camera };
  }

  /** How much of the browser's storage StyleCode is using, where the browser says. */
  async storageUsage(): Promise<StorageUsage | null> {
    try {
      const estimate = await navigator.storage?.estimate?.();
      if (!estimate?.quota) return null;
      return { usage: estimate.usage ?? 0, quota: estimate.quota };
    } catch {
      return null;
    }
  }

  private async checkSpace(): Promise<void> {
    if (this.warnedNearlyFull) return;
    const space = await this.storageUsage();
    if (!space || space.usage / space.quota < NEARLY_FULL) return;
    this.warnedNearlyFull = true;
    this.editor.notify('Browser storage is nearly full. Save designs to files, or delete old ones in Designs.', 'error');
  }

  async listProjects(): Promise<ProjectSummary[]> {
    const records = await idbGetAll<ProjectRecord>(PROJECTS);
    return records
      .map((record) => {
        const parsed = parseProject(record.file);
        return {
          id: record.id,
          name: typeof record.name === 'string' && record.name ? record.name : 'Untitled',
          updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : 0,
          ...(parsed.ok ? {} : { problem: parsed.error }),
        };
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * Downloads a stored project's data exactly as it is kept, including one
   * that can't be opened, so it can be recovered or reported.
   */
  async downloadStoredProject(id: string): Promise<boolean> {
    const record = await idbGet<ProjectRecord>(PROJECTS, id);
    if (!record) throw new Error('That design no longer exists.');
    return saveFile(
      `${(record.name || 'untitled').replace(/[^\w-]+/g, '-').slice(0, 60)}-data.json`,
      { description: 'StyleCode design data', mime: 'application/json', extension: '.json' },
      async () => new Blob([JSON.stringify(record.file, null, 2)], { type: 'application/json' }),
    );
  }

  private async switchTo(doc: DesignDocument, camera: Camera | null): Promise<Camera | null> {
    if (!(await this.mayReplace())) throw new KeptOpenError(this.canSave);
    if (this.company) this.dropCompany();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.editor.loadDocument(doc);
    this.replaced();
    this.lastSavedDoc = null;
    writeLastProjectId(doc.id);
    await this.saveNow();
    return camera;
  }

  async newProject(): Promise<Camera | null> {
    return this.switchTo(createStarterDocument(), null);
  }

  async newExampleProject(): Promise<Camera | null> {
    return this.switchTo(createExampleDocument(), null);
  }

  async openProject(id: string): Promise<Camera | null> {
    const record = await idbGet<ProjectRecord>(PROJECTS, id);
    if (!record) throw new Error('That design no longer exists.');
    const parsed = parseProject(record.file);
    if (!parsed.ok) throw new Error(parsed.error);
    if (!(await this.mayReplace())) throw new KeptOpenError(this.canSave);
    if (this.company) this.dropCompany();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.editor.loadDocument(parsed.doc);
    this.replaced();
    this.lastSavedDoc = this.editor.committedDoc;
    writeLastProjectId(id);
    this.set({ status: 'saved', error: null });
    return record.camera ?? null;
  }

  /** One of the editor's own designs, as this browser keeps it: read only, to copy into an engagement (decision 3). */
  async readStoredProject(id: string): Promise<unknown> {
    const record = await idbGet<ProjectRecord>(PROJECTS, id);
    if (!record) throw new Error('That design no longer exists.');
    return record.file;
  }

  async deleteProject(id: string): Promise<void> {
    await idbDelete(PROJECTS, id);
  }

  /** Imports a project file as a new local project. */
  async importFromFile(): Promise<{ camera: Camera | null; warnings: number } | null> {
    const picked = await pickProjectFile();
    if (!picked) return null;
    const parsed = parseProject(picked.data);
    if (!parsed.ok) throw new Error(parsed.error);
    // An imported file becomes one of the editor's own designs: its images go to this browser's store, never a client's.
    if (this.company) {
      if (!(await this.mayReplace())) throw new KeptOpenError(this.canSave);
      this.dropCompany();
    }
    await importAssets((picked.data as { assets?: unknown }).assets);
    // A fresh id means importing never overwrites a local project with the same origin.
    const doc = { ...parsed.doc, id: createId('doc') };
    await this.switchTo(doc, null);
    return { camera: null, warnings: parsed.warnings.length };
  }

  async exportToFile(): Promise<boolean> {
    const doc = this.editor.committedDoc;
    return exportProjectFile(doc, () => exportAssets(referencedAssets(doc)));
  }

  dispose(): void {
    this.flush();
    this.unsubscribe?.();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    window.removeEventListener('pagehide', this.flush);
    window.removeEventListener('beforeunload', this.onBeforeUnload);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.channel?.close();
  }
}

/** Opening another project was called off, to keep changes that couldn't be saved. */
export class KeptOpenError extends Error {
  constructor(canRetry = true) {
    super(
      canRetry
        ? 'Kept this design open. Its latest changes still aren’t saved: try saving again, or save it to a file.'
        : 'Kept this design open. This browser isn’t letting StyleCode save, so save it to a file first.',
    );
    this.name = 'KeptOpenError';
  }
}

function isQuotaError(error: unknown): boolean {
  const name = (error as DOMException | null)?.name;
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED';
}
