import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { parseProject, referencedAssets } from '../../src/model/serialize';
import type { CompanyWorkspace } from '../../src/workspace/model/types.ts';
import { RequestError } from '../shared/requests.ts';
import type { RetryOptions } from '../shared/rename.ts';
import { isSafeId, replaceFile, type WorkspaceStore } from './store.ts';

/**
 * An engagement's designs on disk (ADR-0006, ADR-0007; Phase 4 brief,
 * decisions 2, 3, 6 and 8):
 *
 *   <company>/designs/<document id>.stylecode.json           the design, in the editor's own format
 *   <company>/designs/<document id>.previous.stylecode.json  the copy before its last save
 *   <company>/designs/assets/<asset id>                      an image, under the editor's content-hash id
 *   <company>/designs/assets/<asset id>.type                 its media type
 *
 * Saves follow `workspace.json`'s rules: one at a time in the company's queue,
 * through a temporary file renamed into place, the last good copy kept, and a
 * stale revision refused. A design is read, saved or downloaded only if the
 * client's saved workspace lists it; creating one never overwrites a file,
 * listed or not. Images are stored only in the company named, under the id
 * their bytes hash to. A permanent save of the client removes the designs it
 * no longer lists, and the images none of its designs use.
 */

/** A design's file. The 5,000-layer performance document is 5.6 MB. */
export const MAX_DESIGN_BYTES = 50 * 1024 * 1024;
/** One image, as the editor allows (`MAX_IMAGE_BYTES`). */
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
/** How long a design or image nothing lists is kept, as uploads are (Phase 1, decision 5). */
const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;
const ASSET_ID = /^asset_[0-9a-f]{32}$/;
/** The image types the editor accepts (`isExportableImage`). */
const IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/svg+xml',
  'image/bmp',
  'image/x-icon',
  'image/vnd.microsoft.icon',
]);

const revisionOf = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
/** The id the editor gives an image: the first 32 hex digits of its SHA-256 (`persistence/assets.ts`). */
export const assetIdOf = (bytes: Buffer) => `asset_${createHash('sha256').update(bytes).digest('hex').slice(0, 32)}`;

export interface DesignSummary {
  documentId: string;
  /** Why it can't be opened: its file is missing, damaged or from a newer StyleCode. */
  problem: string | null;
  sizeBytes: number;
}

export class DesignFiles {
  /** Designs and images written since the server started: a save never removes them, so undo and redo can't lose one. */
  private readonly written = new Set<string>();
  /**
   * When each design and image was last written in this server's life, in order (a count, not a clock). An image
   * uploaded after the last save of the design being deleted is wanted by another design whose save may not have
   * arrived yet, so the deletion leaves it.
   */
  private readonly lastWrite = new Map<string, number>();
  private writes = 0;

  constructor(
    private readonly store: WorkspaceStore,
    private readonly options: { retry?: RetryOptions; now?: () => Date } = {},
  ) {
    // The save itself is done by now: a file another program holds open is left for the next permanent save,
    // rather than reporting a save that worked as failed. Only the error's code is logged, never a path.
    store.afterPermanentSave.push((companyId, before, after) =>
      this.clearUp(companyId, before, after).catch((error: NodeJS.ErrnoException) => {
        console.error('[stylecode designs] clearing up after a save failed', error?.code ?? 'unknown');
      }),
    );
  }

  private folder(companyId: string): string {
    return join(this.store.companyFolder(companyId), 'designs');
  }

  private fileOf(companyId: string, documentId: string): string {
    if (!isSafeId(documentId)) throw new RequestError('Invalid id.', 400);
    return join(this.folder(companyId), `${documentId}.stylecode.json`);
  }

  /** The client's saved workspace, which must list the design; and whether the client can be changed. */
  private async listed(companyId: string, documentId: string): Promise<{ editable: boolean }> {
    const opened = await this.store.read(companyId);
    if (!Object.values(opened.workspace.designs).some((d) => d.documentId === documentId)) {
      throw new RequestError('There is no such design.', 404);
    }
    return { editable: opened.access === 'editable' };
  }

  private async editable(companyId: string): Promise<void> {
    const opened = await this.store.read(companyId);
    if (opened.access !== 'editable') {
      throw new RequestError('This client’s file has problems, so nothing can be added to it or saved.', 409);
    }
  }

  private async ensureFolders(companyId: string): Promise<void> {
    // Never recursive from the company's folder: it must already exist.
    for (const dir of [this.folder(companyId), join(this.folder(companyId), 'assets')]) {
      await mkdir(dir, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error;
      });
    }
  }

  /** A design file as sent: refused unless the editor's own parser accepts it, as the right document, under the size limit. */
  private static check(file: unknown, documentId: string): string {
    const parsed = parseProject(file);
    if (!parsed.ok) throw new RequestError(parsed.error, 400);
    if (parsed.doc.id !== documentId) throw new RequestError('The design file is for another document.', 400);
    const bytes = JSON.stringify(file);
    if (Buffer.byteLength(bytes) > MAX_DESIGN_BYTES) {
      throw new RequestError(`The design is too large. The limit is ${MAX_DESIGN_BYTES / 1024 / 1024} MB.`, 413);
    }
    return bytes;
  }

  /** The client's designs as listed, each with whether it can be opened. */
  async list(companyId: string): Promise<DesignSummary[]> {
    const opened = await this.store.read(companyId);
    const out: DesignSummary[] = [];
    for (const d of Object.values(opened.workspace.designs)) {
      if (!isSafeId(d.documentId)) {
        out.push({ documentId: d.documentId, problem: 'The design has an invalid id.', sizeBytes: 0 });
        continue;
      }
      let bytes: Buffer;
      try {
        bytes = await readFile(this.fileOf(companyId, d.documentId));
      } catch {
        out.push({ documentId: d.documentId, problem: 'The design’s file is missing from the client’s folder.', sizeBytes: 0 });
        continue;
      }
      let problem: string | null = null;
      try {
        const parsed = parseProject(JSON.parse(bytes.toString('utf8')));
        problem = parsed.ok ? null : parsed.error;
      } catch {
        problem = 'The design’s file is damaged and can’t be read.';
      }
      out.push({ documentId: d.documentId, problem, sizeBytes: bytes.length });
    }
    return out;
  }

  /** A listed design: its file as stored, and its revision. */
  async read(companyId: string, documentId: string): Promise<{ file: unknown; revision: string }> {
    await this.listed(companyId, documentId);
    let bytes: Buffer;
    try {
      bytes = await readFile(this.fileOf(companyId, documentId));
    } catch {
      throw new RequestError('The design’s file is missing from the client’s folder.', 404);
    }
    let file: unknown;
    try {
      file = JSON.parse(bytes.toString('utf8'));
    } catch {
      throw new RequestError('The design’s file is damaged and can’t be read.', 422);
    }
    const parsed = parseProject(file);
    if (!parsed.ok) throw new RequestError(parsed.error, 422);
    return { file, revision: revisionOf(bytes) };
  }

  /** A listed design's file exactly as stored, for Download (decision 7). */
  async raw(companyId: string, documentId: string): Promise<Buffer> {
    await this.listed(companyId, documentId);
    try {
      return await readFile(this.fileOf(companyId, documentId));
    } catch {
      throw new RequestError('The design’s file is missing from the client’s folder.', 404);
    }
  }

  /**
   * Creates a design's file: a new design or a copy (decisions 1 and 3). The
   * app lists it in the workspace afterwards. It only ever creates: an id
   * that already has a file, listed or not, is refused.
   */
  async create(companyId: string, documentId: unknown, file: unknown): Promise<{ revision: string }> {
    if (!isSafeId(documentId)) throw new RequestError('Invalid id.', 400);
    const bytes = DesignFiles.check(file, documentId);
    return this.store.inQueue(companyId, async () => {
      await this.editable(companyId);
      await this.ensureFolders(companyId);
      const path = this.fileOf(companyId, documentId);
      const exists = await stat(path).then(
        () => true,
        () => false,
      );
      if (exists) throw new RequestError('A design with this id exists already.', 409);
      this.written.add(`${companyId}/${documentId}`);
      this.lastWrite.set(`${companyId}/${documentId}`, ++this.writes);
      await replaceFile(path, bytes, this.options.retry);
      return { revision: revisionOf(bytes) };
    });
  }

  /** Saves a listed design over the revision it was based on (decision 2). */
  async save(companyId: string, documentId: string, file: unknown, baseRevision: unknown): Promise<{ revision: string }> {
    if (typeof baseRevision !== 'string' || !/^[0-9a-f]{64}$/.test(baseRevision)) {
      throw new RequestError('The save must name the revision it is based on.', 400);
    }
    const bytes = DesignFiles.check(file, documentId);
    return this.store.inQueue(companyId, async () => {
      const { editable } = await this.listed(companyId, documentId);
      if (!editable) throw new RequestError('This client’s file has problems, so StyleCode won’t save over its designs.', 409);
      const path = this.fileOf(companyId, documentId);
      let current: Buffer;
      try {
        current = await readFile(path);
      } catch {
        throw new RequestError('The design’s file is missing from the client’s folder.', 404);
      }
      if (revisionOf(current) !== baseRevision) {
        throw new RequestError('This design changed in another tab. Reload it to carry on.', 409);
      }
      await replaceFile(join(this.folder(companyId), `${documentId}.previous.stylecode.json`), current, this.options.retry);
      this.lastWrite.set(`${companyId}/${documentId}`, ++this.writes);
      await replaceFile(path, bytes, this.options.retry);
      return { revision: revisionOf(bytes) };
    });
  }

  /** Stores an image in the company named, under the id its bytes hash to (decision 2). */
  async addAsset(companyId: string, bytes: Buffer, mediaType: unknown): Promise<{ id: string }> {
    const type = typeof mediaType === 'string' ? mediaType.split(';')[0].trim().toLowerCase() : '';
    if (!IMAGE_TYPES.has(type)) throw new RequestError('That image format isn’t supported.', 415);
    if (bytes.length > MAX_IMAGE_BYTES) throw new RequestError('That image is larger than 15 MB.', 413);
    if (!bytes.length) throw new RequestError('The image is empty.', 400);
    const id = assetIdOf(bytes);
    return this.store.inQueue(companyId, async () => {
      await this.editable(companyId);
      await this.ensureFolders(companyId);
      const path = join(this.folder(companyId), 'assets', id);
      this.written.add(`${companyId}/${id}`);
      this.lastWrite.set(`${companyId}/${id}`, ++this.writes);
      const exists = await stat(path).then(
        () => true,
        () => false,
      );
      if (!exists) {
        await replaceFile(`${path}.type`, type, this.options.retry);
        await replaceFile(path, bytes, this.options.retry);
      }
      return { id };
    });
  }

  /** An image of the company named. */
  async openAsset(companyId: string, assetId: string): Promise<{ type: string; bytes: Buffer }> {
    if (!ASSET_ID.test(assetId)) throw new RequestError('Invalid id.', 400);
    await this.store.read(companyId);
    const path = join(this.folder(companyId), 'assets', assetId);
    try {
      const [bytes, type] = await Promise.all([readFile(path), readFile(`${path}.type`, 'utf8')]);
      return { bytes, type: IMAGE_TYPES.has(type.trim()) ? type.trim() : 'application/octet-stream' };
    } catch {
      throw new RequestError('There is no such image.', 404);
    }
  }

  /**
   * After a permanent save, in the company's queue: the designs the client no
   * longer lists go now, with the images only they used (decision 6); a
   * design or image nothing lists or uses, and that wasn't written since the
   * server started, goes once it is a day old.
   */
  private async clearUp(companyId: string, before: CompanyWorkspace, after: CompanyWorkspace): Promise<void> {
    const dir = this.folder(companyId);
    const names = await readdir(dir).catch(() => null);
    if (!names) return;
    // Temporary files an interrupted save left behind.
    for (const folder of [dir, join(dir, 'assets')]) {
      for (const name of await readdir(folder).catch(() => [] as string[])) {
        if (/\.[0-9a-f]{12}\.tmp$/.test(name)) await rm(join(folder, name), { force: true }).catch(() => undefined);
      }
    }
    const listed = new Set(Object.values(after.designs).map((d) => d.documentId));
    const removed = new Set(
      Object.values(before.designs)
        .map((d) => d.documentId)
        .filter((id) => !listed.has(id)),
    );
    const cutoff = (this.options.now?.() ?? new Date()).getTime() - ORPHAN_GRACE_MS;
    const old = async (path: string) =>
      (await stat(path).then(
        (s) => s.mtimeMs,
        () => Infinity,
      )) <= cutoff;

    const used = new Set<string>();
    let unreadable = false;
    // Each image a deleted design used, with when that design was last written (0: not in this server's life).
    const freed = new Map<string, number>();
    for (const name of names) {
      const match = /^(.+?)(\.previous)?\.stylecode\.json$/.exec(name);
      if (!match) continue;
      const documentId = match[1];
      const path = join(dir, name);
      // A design that can't be parsed (damaged, or from a newer StyleCode) still keeps its images: every image id in its
      // text counts as used, so a repaired or upgraded design comes back whole. One that can't be read at all keeps them all.
      const assets = await readFile(path, 'utf8')
        .then((text) => {
          try {
            const parsed = parseProject(JSON.parse(text));
            if (parsed.ok) return referencedAssets(parsed.doc);
          } catch {
            // Read as text, below.
          }
          return text.match(/asset_[0-9a-f]{32}/g) ?? [];
        })
        .catch(() => {
          unreadable = true;
          return [] as string[];
        });
      const keep =
        listed.has(documentId) ||
        (!removed.has(documentId) && (this.written.has(`${companyId}/${documentId}`) || !(await old(path))));
      if (keep) {
        for (const id of assets) used.add(id);
        continue;
      }
      const lastSaved = this.lastWrite.get(`${companyId}/${documentId}`) ?? 0;
      for (const id of assets) freed.set(id, Math.max(freed.get(id) ?? 0, lastSaved));
      this.written.delete(`${companyId}/${documentId}`);
      await rm(path, { force: true, maxRetries: 5, retryDelay: 200 });
    }

    // Forgotten only now: a design's last good copy (`.previous`) is read before the design itself.
    for (const documentId of removed) this.lastWrite.delete(`${companyId}/${documentId}`);
    // With a design that couldn't be read, which images it uses is unknown: none is deleted this time.
    if (unreadable) return;
    const assetDir = join(dir, 'assets');
    for (const name of await readdir(assetDir).catch(() => [] as string[])) {
      const id = name.replace(/\.type$/, '');
      if (!ASSET_ID.test(id) || used.has(id)) continue;
      const path = join(assetDir, id);
      if (!freed.has(id) && (this.written.has(`${companyId}/${id}`) || !(await old(path)))) continue;
      // Uploaded again since the deleted design was last saved: another design is using it and may not have saved yet.
      if (freed.has(id) && (this.lastWrite.get(`${companyId}/${id}`) ?? 0) > freed.get(id)!) continue;
      this.written.delete(`${companyId}/${id}`);
      this.lastWrite.delete(`${companyId}/${id}`);
      await rm(join(assetDir, name), { force: true, maxRetries: 5, retryDelay: 200 });
    }
  }
}
