import type { Camera } from '../editor/camera';
import type { Editor } from '../editor/editor';
import { createNode } from '../model/defaults';
import { createDocument } from '../model/document';
import { createId } from '../model/ids';
import { applyOps } from '../model/ops';
import { parseProject, toProjectFile, type ProjectFile } from '../model/serialize';
import type { DesignDocument } from '../model/types';
import { createExampleDocument } from './examples';
import { exportProjectFile, pickProjectFile } from './files';
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
}

export type SaveStatus = 'saved' | 'saving' | 'pending' | 'error' | 'unavailable';

export interface SessionState {
  status: SaveStatus;
  error: string | null;
}

const LAST_PROJECT_KEY = 'stylecode:last-project';
const SAVE_DELAY_MS = 500;

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
  private unsubscribe: (() => void) | null = null;
  private readonly channel: BroadcastChannel | null;
  private readonly tabId = createId('tab');

  constructor(private readonly editor: Editor) {
    this.channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('stylecode') : null;
    this.channel?.addEventListener('message', (e: MessageEvent<{ id: string; tab: string }>) => {
      if (e.data?.tab !== this.tabId && e.data?.id === this.editor.getState().doc.id) {
        this.editor.notify('This project is also open in another tab. The tab that saves last wins.', 'error');
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

  /** Opens the most recent project, or creates a starter project. Returns its saved camera, if any. */
  async init(): Promise<Camera | null> {
    let camera: Camera | null = null;
    try {
      const lastId = readLastProjectId();
      const record = lastId ? await idbGet<ProjectRecord>(PROJECTS, lastId) : undefined;
      const parsed = record ? parseProject(record.file) : null;
      if (record && parsed?.ok) {
        this.editor.loadDocument(parsed.doc);
        camera = record.camera ?? null;
        this.lastSavedDoc = parsed.doc;
      } else {
        const projects = await this.listProjects();
        const latest = projects[0] ? await idbGet<ProjectRecord>(PROJECTS, projects[0].id) : undefined;
        const latestParsed = latest ? parseProject(latest.file) : null;
        if (latest && latestParsed?.ok) {
          this.editor.loadDocument(latestParsed.doc);
          camera = latest.camera ?? null;
          this.lastSavedDoc = latestParsed.doc;
        } else {
          this.editor.loadDocument(createStarterDocument());
          await this.saveNow();
        }
      }
      writeLastProjectId(this.editor.getState().doc.id);
    } catch (error) {
      this.storageAvailable = false;
      this.editor.loadDocument(createStarterDocument());
      this.set({ status: 'unavailable', error: (error as Error).message });
    }
    this.start();
    return camera;
  }

  private start(): void {
    this.unsubscribe?.();
    this.lastCamera = this.editor.getState().camera;
    this.unsubscribe = this.editor.subscribe(() => {
      const { doc, camera, gesturing } = this.editor.getState();
      if (gesturing) return;
      const docChanged = doc !== this.lastSavedDoc;
      const cameraChanged = camera !== this.lastCamera;
      if (!docChanged && !cameraChanged) return;
      if (docChanged && this.storageAvailable) this.set({ status: 'pending' });
      this.schedule();
    });
    window.addEventListener('pagehide', this.flush);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  private onVisibility = () => {
    if (document.visibilityState === 'hidden') this.flush();
  };

  private schedule(): void {
    if (!this.storageAvailable) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.saveNow(), SAVE_DELAY_MS);
  }

  flush = (): void => {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
      void this.saveNow();
    }
  };

  async saveNow(): Promise<void> {
    if (!this.storageAvailable) return;
    this.timer = null;
    const { doc, camera } = this.editor.getState();
    const record: ProjectRecord = { id: doc.id, name: doc.name, updatedAt: Date.now(), camera, file: toProjectFile(doc) };
    const docChanged = doc !== this.lastSavedDoc;
    if (docChanged) this.set({ status: 'saving' });
    try {
      await idbPut(PROJECTS, record);
      this.lastSavedDoc = doc;
      this.lastCamera = camera;
      if (docChanged) this.channel?.postMessage({ id: doc.id, tab: this.tabId });
      // A newer change may have arrived while saving.
      if (this.editor.getState().doc === doc) this.set({ status: 'saved', error: null });
    } catch (error) {
      const message =
        (error as DOMException)?.name === 'QuotaExceededError'
          ? 'Browser storage is full. Save the project to a file to keep your work.'
          : `Could not save: ${(error as Error).message}`;
      this.set({ status: 'error', error: message });
      this.editor.notify(message, 'error');
    }
  }

  async listProjects(): Promise<ProjectSummary[]> {
    const records = await idbGetAll<ProjectRecord>(PROJECTS);
    return records.map(({ id, name, updatedAt }) => ({ id, name, updatedAt })).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  private async switchTo(doc: DesignDocument, camera: Camera | null): Promise<Camera | null> {
    this.flush();
    if (this.timer) clearTimeout(this.timer);
    this.editor.loadDocument(doc);
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
    if (!record) throw new Error('That project no longer exists.');
    const parsed = parseProject(record.file);
    if (!parsed.ok) throw new Error(parsed.error);
    this.flush();
    this.editor.loadDocument(parsed.doc);
    this.lastSavedDoc = parsed.doc;
    writeLastProjectId(id);
    this.set({ status: 'saved', error: null });
    return record.camera ?? null;
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
    // A fresh id means importing never overwrites a local project with the same origin.
    const doc = { ...parsed.doc, id: createId('doc') };
    await this.switchTo(doc, null);
    return { camera: null, warnings: parsed.warnings.length };
  }

  async exportToFile(): Promise<boolean> {
    return exportProjectFile(this.editor.getState().doc);
  }

  dispose(): void {
    this.flush();
    this.unsubscribe?.();
    window.removeEventListener('pagehide', this.flush);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.channel?.close();
  }
}
