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
  /** Engagements still active, for the clients list. */
  activeEngagements: number;
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
/** Maps whose entries are permanent deletions when they disappear (Phase 1 brief, decision 5). */
const PERMANENT_MAPS = ['engagements', 'sessions', 'transcripts', 'files'] as const;
/** How long an upload nothing lists is kept, so undo and redo across a restart can't lose it. */
const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

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

  /**
   * Reads a company's file. A file whose company id isn't its folder's name
   * (a backup copied back under another name, say) opens read-only with that
   * problem, so it is never saved under the wrong client.
   */
  private static parse(bytes: Buffer, companyId: string): ReturnType<typeof parseWorkspace> {
    let data: unknown;
    try {
      data = JSON.parse(bytes.toString('utf8'));
    } catch {
      return { ok: false, error: "The client's file is damaged and can't be read." };
    }
    const parsed = parseWorkspace(data);
    if (!parsed.ok || parsed.workspace.company.id === companyId) return parsed;
    const problem: Problem = {
      code: 'company.folder',
      message: `This client's file says it belongs to another client (${String(parsed.workspace.company.id)}), not to the folder it is in (${companyId}). Was a folder copied or renamed?`,
      where: { map: 'company' },
    };
    return { ok: true, access: 'read-only', workspace: parsed.workspace, problems: [problem, ...parsed.problems] };
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
      const parsed = WorkspaceStore.parse(bytes, entry.name);
      if (!parsed.ok) {
        out.push({ id: entry.name, name: null, industry: '', changedAt, access: 'unreadable', activeEngagements: 0 });
        continue;
      }
      const { company } = parsed.workspace;
      out.push({
        id: entry.name,
        name: typeof company.name === 'string' ? company.name : null,
        industry: typeof company.industry === 'string' ? company.industry : '',
        changedAt,
        access: parsed.access,
        activeEngagements: Object.values(parsed.workspace.engagements).filter((e) => e?.status?.state === 'active').length,
      });
    }
    return out.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '') || a.id.localeCompare(b.id));
  }

  /** The names of every company except one, for keeping names unique (MVP Q4). */
  private async otherNames(exceptId: string | null): Promise<string[]> {
    return (await this.list()).flatMap((c) => (c.name === null || c.id === exceptId ? [] : [c.name]));
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
    return this.serial('names', async () => {
      if (!isCompanyNameFree(name, await this.otherNames(null)))
        throw new RequestError(`There is already a client called ${name}.`, 409);
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
    const parsed = WorkspaceStore.parse(bytes, companyId);
    if (!parsed.ok) throw new RequestError(parsed.error, 422);
    const revision = revisionOf(bytes);
    if (parsed.access === 'editable') return { ...parsed, revision };
    return { access: 'read-only', workspace: parsed.workspace, problems: parsed.problems, revision };
  }

  /**
   * Saves a company's workspace over the revision it was based on.
   *
   * A save is a permanent deletion when the app says so (`permanent`), or when
   * an engagement, session, transcript or file on disk is missing from the new
   * workspace, whatever the app says. Then the previous copy gets the new
   * state too, so the deleted data doesn't stay behind in it (Phase 1 brief,
   * decision 5), and the bytes of every file no longer listed are deleted.
   */
  async save(companyId: string, input: unknown, baseRevision: unknown, permanent: boolean): Promise<{ revision: string }> {
    const folder = this.folderOf(companyId);
    if (typeof baseRevision !== 'string' || !/^[0-9a-f]{64}$/.test(baseRevision)) {
      throw new RequestError('The save must name the revision it is based on.', 400);
    }
    return this.serial(companyId, async () => {
      await this.clearTemporaryFiles(folder);
      const current = await this.readCompanyFile(companyId);
      if (revisionOf(current) !== baseRevision) {
        throw new RequestError('This client was changed in another window. Reload it to see the latest version.', 409);
      }
      const onDisk = WorkspaceStore.parse(current, companyId);
      if (!onDisk.ok || onDisk.access !== 'editable') {
        throw new RequestError("This client's file has problems, so StyleCode won't save over it.", 409);
      }
      const parsed = parseWorkspace(input);
      if (!parsed.ok) throw new RequestError(parsed.error, 400);
      const workspace = parsed.workspace;
      if (workspace.company?.id !== companyId) throw new RequestError('The workspace belongs to another client.', 400);
      const check = checkBeforeSave(workspace);
      if (!check.ok) throw new ProblemsError(check.error, 422, check.problems);
      if (workspace.company.name.trim().toLocaleLowerCase() !== onDisk.workspace.company.name.trim().toLocaleLowerCase()) {
        const names = await this.serial('names', () => this.otherNames(companyId));
        if (!isCompanyNameFree(workspace.company.name, names)) {
          throw new RequestError(`There is already a client called ${workspace.company.name.trim()}.`, 409);
        }
      }

      const removed = (map: (typeof PERMANENT_MAPS)[number]) =>
        Object.keys(onDisk.workspace[map]).filter((id) => !Object.hasOwn(workspace[map], id));
      const removedFiles = removed('files');
      const isPermanent = permanent || PERMANENT_MAPS.some((map) => removed(map).length > 0);

      const bytes = JSON.stringify(workspace);
      const main = join(folder, 'workspace.json');
      const previous = join(folder, 'workspace.previous.json');
      if (isPermanent) {
        // The previous copy first: if it can't take the new state, it is removed, and if even that fails
        // the save stops before anything changes, so deleted data is never left only in the previous copy.
        try {
          await this.replaceFile(previous, bytes);
        } catch (error) {
          await rm(previous, { force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {
            throw error;
          });
        }
        await this.replaceFile(main, bytes);
        for (const id of removedFiles) {
          this.uploaded.delete(`${companyId}/${id}`);
          if (isSafeId(id)) await this.deleteBytes(companyId, id);
        }
        await this.removeOrphanedFiles(companyId, workspace);
      } else {
        await this.replaceFile(previous, current);
        await this.replaceFile(main, bytes);
      }
      return { revision: revisionOf(bytes) };
    });
  }

  private async deleteBytes(companyId: string, fileId: string): Promise<void> {
    await rm(join(this.folderOf(companyId), 'files', fileId), { force: true, maxRetries: 5, retryDelay: 200 });
  }

  /** Removes temporary files a save interrupted by a crash left in a company's folder. Runs inside the company's queue. */
  private async clearTemporaryFiles(folder: string): Promise<void> {
    const names = await readdir(folder).catch(() => [] as string[]);
    for (const name of names) {
      if (/^workspace(\.previous)?\.json\.[0-9a-f]+\.tmp$/.test(name)) {
        await rm(join(folder, name), { force: true, maxRetries: 3, retryDelay: 100 }).catch(() => undefined);
      }
    }
  }

  /**
   * Removes stored bytes nothing lists: uploads the app never added to the
   * client, and leftovers of failed uploads. A file uploaded since the server
   * started, or in the last day, is kept, so an undo and redo can't lose it.
   */
  private async removeOrphanedFiles(companyId: string, workspace: CompanyWorkspace): Promise<void> {
    const dir = join(this.folderOf(companyId), 'files');
    const names = await readdir(dir).catch(() => [] as string[]);
    const cutoff = (this.options.now?.() ?? new Date()).getTime() - ORPHAN_GRACE_MS;
    for (const name of names) {
      const id = name.endsWith('.tmp') ? name.slice(0, -4) : name;
      if (this.uploaded.has(`${companyId}/${id}`)) continue;
      if (!name.endsWith('.tmp') && Object.hasOwn(workspace.files, id)) continue;
      const changed = await stat(join(dir, name)).then(
        (s) => s.mtimeMs,
        () => 0,
      );
      if (changed > cutoff) continue;
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
      const parsed = WorkspaceStore.parse(await this.readCompanyFile(companyId), companyId);
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

  /**
   * Stores an uploaded file's bytes under a new id. The workspace's file entry
   * is added by the app. The checks before and the rename after run in the
   * company's queue, so an upload can't recreate the folder of a client being
   * deleted; the bytes themselves stream outside it, so saves aren't held up.
   */
  async addFile(
    companyId: string,
    source: AsyncIterable<Buffer> | Iterable<Buffer>,
    maxBytes: number,
  ): Promise<{ id: string; sizeBytes: number }> {
    const folder = this.folderOf(companyId);
    const dir = join(folder, 'files');
    const id = createId('fi');
    const key = `${companyId}/${id}`;
    const temp = join(dir, `${id}.tmp`);
    const ready = async () => {
      const parsed = WorkspaceStore.parse(await this.readCompanyFile(companyId), companyId);
      if (!parsed.ok || parsed.access !== 'editable') {
        throw new RequestError("This client's file has problems, so nothing can be added to it.", 409);
      }
      // Never recursive: the company's folder must already exist.
      await mkdir(dir, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error;
      });
    };
    const handle = await this.serial(companyId, async () => {
      await ready();
      this.uploaded.add(key);
      return open(temp, 'wx', 0o600);
    });
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
      await this.serial(companyId, async () => {
        await ready(); // The client may have been deleted while the bytes arrived.
        await renameWithRetry(temp, join(dir, id), this.options.retry);
      });
    } catch (error) {
      await handle.close().catch(() => undefined);
      await rm(temp, { force: true }).catch(() => undefined);
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
   * Removes a stored file's bytes that the client doesn't list (an upload the
   * app abandoned). Removing a listed file is a save without its entry, which
   * deletes the bytes itself.
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
