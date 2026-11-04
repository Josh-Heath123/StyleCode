import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readdir, readFile, rm, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import {
  checkBeforeSave,
  createWorkspace,
  isCompanyNameFree,
  parseWorkspace,
  type CompanyWorkspace,
  type Problem,
} from '../../src/workspace/model/index.ts';
import { createId, isValidId } from '../../src/model/ids.ts';
import { renameWithRetry, type RetryOptions } from '../shared/rename.ts';
import { RequestError } from '../shared/requests.ts';

/**
 * The workspace on disk (ADR-0006):
 *
 *   <data folder>/settings.json
 *   <data folder>/companies/<company id>/workspace.json           the CompanyWorkspace
 *   <data folder>/companies/<company id>/workspace.previous.json  the copy before the last save
 *   <data folder>/companies/<company id>/files/<file id>          an attached file's bytes
 *
 * Saves for a company happen one at a time. Each names the revision it is
 * based on (a hash of the file), and is refused if the file has changed since.
 * New content is written to a temporary file and renamed into place, so an
 * interrupted save leaves the last good file untouched. Names from the browser
 * never become paths: only ids do, and only after `isSafeId`.
 */

/** A request with problems in the workspace it sent, or in the one on disk. */
export class ProblemsError extends RequestError {
  constructor(
    message: string,
    status: number,
    readonly problems: Problem[],
  ) {
    super(message, status);
  }
}

/** Names Windows reserves for devices, which can't be file or folder names. */
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/**
 * Whether an id can become part of a path: a valid id (`isValidId`), in lower
 * case (so two ids can't name the same folder on Windows or macOS), and not a
 * name Windows reserves. Ids StyleCode creates always pass.
 */
export function isSafeId(id: unknown): id is string {
  return isValidId(id) && /^[a-z0-9_-]+$/.test(id) && !RESERVED.test(id);
}

export function revisionOf(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export interface CompanySummary {
  id: string;
  /** Null when the file can't be read at all. */
  name: string | null;
  industry: string;
  /** When the company's file was last saved. */
  changedAt: string;
  /** `read-only` when the file has problems; `unreadable` when it can't be opened at all. */
  access: 'editable' | 'read-only' | 'unreadable';
}

export type OpenedWorkspace =
  | { access: 'editable'; workspace: CompanyWorkspace; problems: []; revision: string }
  | { access: 'read-only'; workspace: CompanyWorkspace; problems: Problem[]; revision: string };

export interface Settings {
  /** The consultant's name, recorded on everything they enter. Null until they give it. */
  consultantName: string | null;
}

const SETTINGS_FORMAT = 'stylecode-settings';
const PROFILE_FIELDS = ['name', 'industry', 'description', 'existingSystems', 'notes'] as const;

export interface StoreOptions {
  /** For tests: how renames are retried. */
  retry?: RetryOptions;
  /** For tests: the current time. */
  now?: () => Date;
}

export class WorkspaceStore {
  private readonly queues = new Map<string, Promise<unknown>>();
  /** Files uploaded since the server started. A save never removes them, so undo and redo can't lose one. */
  private readonly uploaded = new Set<string>();

  constructor(
    readonly root: string,
    private readonly options: StoreOptions = {},
  ) {}

  private get companies(): string {
    return join(this.root, 'companies');
  }

  private folderOf(companyId: string): string {
    if (!isSafeId(companyId)) throw new RequestError('Invalid id.', 400);
    return join(this.companies, companyId);
  }

  private now(): string {
    return (this.options.now?.() ?? new Date()).toISOString();
  }

  /** Runs one change at a time for a key (a company, or company creation as a whole). */
  private serial<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve();
    const next = previous.then(task, task);
    const settled = next.catch(() => undefined);
    this.queues.set(key, settled);
    void settled.then(() => {
      if (this.queues.get(key) === settled) this.queues.delete(key);
    });
    return next;
  }

  /** Writes bytes to a file through a temporary file, flushed to disk, then renamed into place. */
  private async replaceFile(path: string, bytes: Buffer | string): Promise<void> {
    const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
    const handle = await open(temp, 'wx', 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await renameWithRetry(temp, path, this.options.retry);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
  }

  private async readCompanyFile(companyId: string): Promise<Buffer> {
    try {
      return await readFile(join(this.folderOf(companyId), 'workspace.json'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new RequestError('There is no such client.', 404);
      throw error;
    }
  }

  private static parse(bytes: Buffer): ReturnType<typeof parseWorkspace> {
    let data: unknown;
    try {
      data = JSON.parse(bytes.toString('utf8'));
    } catch {
      return { ok: false, error: "The client's file is damaged and can't be read." };
    }
    return parseWorkspace(data);
  }

  /** Every company in the folder, by name. */
  async list(): Promise<CompanySummary[]> {
    await this.clearUnfinishedDeletes();
    const entries = await readdir(this.companies, { withFileTypes: true });
    const out: CompanySummary[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !isSafeId(entry.name)) continue;
      const file = join(this.companies, entry.name, 'workspace.json');
      let bytes: Buffer;
      let changedAt: string;
      try {
        [bytes, changedAt] = await Promise.all([readFile(file), stat(file).then((s) => s.mtime.toISOString())]);
      } catch {
        continue; // Not a company folder (or one still being created).
      }
      const parsed = WorkspaceStore.parse(bytes);
      if (!parsed.ok) {
        out.push({ id: entry.name, name: null, industry: '', changedAt, access: 'unreadable' });
        continue;
      }
      const { company } = parsed.workspace;
      out.push({
        id: entry.name,
        name: typeof company.name === 'string' ? company.name : null,
        industry: typeof company.industry === 'string' ? company.industry : '',
        changedAt,
        access: parsed.access,
      });
    }
    return out.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '') || a.id.localeCompare(b.id));
  }

  /** Creates a company, refusing a name another company already has (ignoring case). */
  async create(profile: Record<string, unknown>): Promise<OpenedWorkspace> {
    const fields: Record<string, string> = {};
    for (const key of PROFILE_FIELDS) {
      const value = profile[key];
      if (value === undefined) continue;
      if (typeof value !== 'string') throw new RequestError(`The company's ${key} must be text.`, 400);
      fields[key] = value;
    }
    const name = (fields.name ?? '').trim();
    if (!name) throw new RequestError('Give the company a name.', 400);
    return this.serial('create', async () => {
      const names = (await this.list()).flatMap((c) => (c.name === null ? [] : [c.name]));
      if (!isCompanyNameFree(name, names)) throw new RequestError(`There is already a client called ${name}.`, 409);
      const workspace = createWorkspace({ ...fields, name }, this.now());
      const check = checkBeforeSave(workspace);
      if (!check.ok) throw new ProblemsError(check.error, 422, check.problems);
      const folder = this.folderOf(workspace.company.id);
      await mkdir(folder, { mode: 0o700 }); // Fails if the id is somehow taken.
      await mkdir(join(folder, 'files'), { mode: 0o700 });
      const bytes = JSON.stringify(workspace);
      await this.replaceFile(join(folder, 'workspace.json'), bytes);
      return { access: 'editable', workspace, problems: [], revision: revisionOf(bytes) };
    });
  }

  /** Opens a company: editable when valid, read-only with its problems when not. */
  async read(companyId: string): Promise<OpenedWorkspace> {
    const bytes = await this.readCompanyFile(companyId);
    const parsed = WorkspaceStore.parse(bytes);
    if (!parsed.ok) throw new RequestError(parsed.error, 422);
    const revision = revisionOf(bytes);
    if (parsed.access === 'editable') return { ...parsed, revision };
    return { access: 'read-only', workspace: parsed.workspace, problems: parsed.problems, revision };
  }

  /**
   * Saves a company's workspace over the revision it was based on.
   *
   * `permanent` says the save makes a permanent deletion (an engagement, a
   * session, a transcript or a file). Then the previous copy is overwritten
   * with the new state too, so the deleted data doesn't stay behind in it.
   */
  async save(companyId: string, input: unknown, baseRevision: unknown, permanent: boolean): Promise<{ revision: string }> {
    const folder = this.folderOf(companyId);
    if (typeof baseRevision !== 'string' || !/^[0-9a-f]{64}$/.test(baseRevision)) {
      throw new RequestError('The save must name the revision it is based on.', 400);
    }
    return this.serial(companyId, async () => {
      const current = await this.readCompanyFile(companyId);
      if (revisionOf(current) !== baseRevision) {
        throw new RequestError('This client was changed in another window. Reload it to see the latest version.', 409);
      }
      const onDisk = WorkspaceStore.parse(current);
      if (!onDisk.ok || onDisk.access !== 'editable') {
        throw new RequestError("This client's file has problems, so StyleCode won't save over it.", 409);
      }
      const parsed = parseWorkspace(input);
      if (!parsed.ok) throw new RequestError(parsed.error, 400);
      const workspace = parsed.workspace;
      if (workspace.company?.id !== companyId) throw new RequestError('The workspace belongs to another client.', 400);
      const check = checkBeforeSave(workspace);
      if (!check.ok) throw new ProblemsError(check.error, 422, check.problems);

      const bytes = JSON.stringify(workspace);
      const main = join(folder, 'workspace.json');
      const previous = join(folder, 'workspace.previous.json');
      if (permanent) {
        await this.replaceFile(main, bytes);
        await this.replaceFile(previous, bytes);
      } else {
        await this.replaceFile(previous, current);
        await this.replaceFile(main, bytes);
      }
      await this.removeUnusedFiles(companyId, workspace);
      return { revision: revisionOf(bytes) };
    });
  }

  /** Removes stored files the saved workspace no longer lists (and leftovers of failed uploads). */
  private async removeUnusedFiles(companyId: string, workspace: CompanyWorkspace): Promise<void> {
    const dir = join(this.folderOf(companyId), 'files');
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const id = name.endsWith('.tmp') ? name.slice(0, -4) : name;
      if (this.uploaded.has(`${companyId}/${id}`)) continue;
      if (!name.endsWith('.tmp') && Object.hasOwn(workspace.files, id)) continue;
      await rm(join(dir, name), { force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined);
    }
  }

  /**
   * Deletes a company and everything in its folder. `confirmName` must repeat
   * the company's exact name (or its id, if the file can't be read), as a
   * second safeguard behind the interface's typed confirmation.
   */
  async remove(companyId: string, confirmName: unknown): Promise<void> {
    const folder = this.folderOf(companyId);
    await this.serial(companyId, async () => {
      const parsed = WorkspaceStore.parse(await this.readCompanyFile(companyId));
      const expected = parsed.ok && typeof parsed.workspace.company.name === 'string' ? parsed.workspace.company.name : companyId;
      if (confirmName !== expected) throw new RequestError("The name doesn't match the client's name.", 400);
      // Move it out of the list first, so a deletion interrupted by a busy file can't leave half a client.
      const doomed = join(this.companies, `.deleting-${companyId}-${randomBytes(4).toString('hex')}`);
      await renameWithRetry(folder, doomed, this.options.retry);
      for (const key of this.uploaded) if (key.startsWith(`${companyId}/`)) this.uploaded.delete(key);
      await rm(doomed, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => undefined);
    });
  }

  /** Finishes deleting companies whose deletion was interrupted (a file was busy). */
  private async clearUnfinishedDeletes(): Promise<void> {
    const entries = await readdir(this.companies).catch(() => [] as string[]);
    for (const name of entries) {
      if (name.startsWith('.deleting-')) {
        await rm(join(this.companies, name), { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }).catch(
          () => undefined,
        );
      }
    }
  }

  /** Stores an uploaded file's bytes under a new id. The workspace's file entry is added by the app. */
  async addFile(
    companyId: string,
    source: AsyncIterable<Buffer> | Iterable<Buffer>,
    maxBytes: number,
  ): Promise<{ id: string; sizeBytes: number }> {
    const parsed = WorkspaceStore.parse(await this.readCompanyFile(companyId));
    if (!parsed.ok || parsed.access !== 'editable') {
      throw new RequestError("This client's file has problems, so nothing can be added to it.", 409);
    }
    const id = createId('fi');
    const dir = join(this.folderOf(companyId), 'files');
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const key = `${companyId}/${id}`;
    this.uploaded.add(key);
    const temp = join(dir, `${id}.tmp`);
    const handle = await open(temp, 'wx', 0o600);
    let size = 0;
    try {
      for await (const chunk of source) {
        size += chunk.length;
        if (size > maxBytes)
          throw new RequestError(`The file is too large. The limit is ${Math.round(maxBytes / 1024 / 1024)} MB.`, 413);
        await handle.write(chunk);
      }
      await handle.sync();
      await handle.close();
      await renameWithRetry(temp, join(dir, id), this.options.retry);
    } catch (error) {
      await handle.close().catch(() => undefined);
      await rm(temp, { force: true });
      this.uploaded.delete(key);
      throw error;
    }
    return { id, sizeBytes: size };
  }

  /** A stored file the saved workspace lists, with its entry. */
  async openFile(companyId: string, fileId: string) {
    const opened = await this.read(companyId);
    if (!isSafeId(fileId) || !Object.hasOwn(opened.workspace.files, fileId)) {
      throw new RequestError('There is no such file.', 404);
    }
    const path = join(this.folderOf(companyId), 'files', fileId);
    try {
      const { size } = await stat(path);
      return { ref: opened.workspace.files[fileId], size, stream: () => createReadStream(path) };
    } catch {
      throw new RequestError("The file's contents are missing from the client's folder.", 404);
    }
  }

  /**
   * Removes a stored file's bytes. The app removes the file's entry from the
   * workspace and saves first, so a file still listed is never removed.
   */
  async removeFile(companyId: string, fileId: string): Promise<void> {
    if (!isSafeId(fileId)) throw new RequestError('Invalid id.', 400);
    await this.serial(companyId, async () => {
      const opened = await this.read(companyId);
      if (Object.hasOwn(opened.workspace.files, fileId)) {
        throw new RequestError('The client still lists this file. Remove it from the client first.', 409);
      }
      this.uploaded.delete(`${companyId}/${fileId}`);
      await unlink(join(this.folderOf(companyId), 'files', fileId)).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    });
  }

  async readSettings(): Promise<Settings> {
    try {
      const raw = JSON.parse(await readFile(join(this.root, 'settings.json'), 'utf8')) as Record<string, unknown>;
      const name = raw?.format === SETTINGS_FORMAT && typeof raw.consultantName === 'string' ? raw.consultantName.trim() : '';
      return { consultantName: name || null };
    } catch {
      return { consultantName: null };
    }
  }

  async saveSettings(update: Record<string, unknown>): Promise<Settings> {
    return this.serial('settings', async () => {
      const settings = await this.readSettings();
      if ('consultantName' in update) {
        const name = typeof update.consultantName === 'string' ? update.consultantName.trim() : '';
        if (!name) throw new RequestError('Give your name.', 400);
        if (name.length > 200) throw new RequestError('The name is too long.', 400);
        settings.consultantName = name;
      }
      await this.replaceFile(
        join(this.root, 'settings.json'),
        `${JSON.stringify({ format: SETTINGS_FORMAT, version: 1, ...settings }, null, 2)}\n`,
      );
      return settings;
    });
  }
}
