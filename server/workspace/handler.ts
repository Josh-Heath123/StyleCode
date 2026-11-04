import type { IncomingMessage, ServerResponse } from 'node:http';
import { pipeline } from 'node:stream/promises';
import { readJson, rejectReason, RequestError, sendJson, type RequestPolicy } from '../shared/requests.ts';
import type { DataFolder } from './folder.ts';
import { isSafeId, ProblemsError, WorkspaceStore } from './store.ts';

/**
 * The local workspace routes, served by StyleCode's own dev and preview servers:
 *
 *   GET    /api/workspace/info                         the data folder in use, and any cloud-sync warning
 *   GET    /api/workspace/settings                     the consultant's settings
 *   PUT    /api/workspace/settings                     change them
 *   GET    /api/workspace/companies                    every client: id, name, industry, last changed, access
 *   POST   /api/workspace/companies                    create a client { profile }
 *   GET    /api/workspace/companies/:id                open a client: workspace, access, problems, revision
 *   PUT    /api/workspace/companies/:id                save { workspace, baseRevision, permanent? }
 *   DELETE /api/workspace/companies/:id                delete a client { confirmName }
 *   POST   /api/workspace/companies/:id/files          store a file's bytes (the body), giving its new id
 *   GET    /api/workspace/companies/:id/files/:fileId  download a file the client lists
 *   DELETE /api/workspace/companies/:id/files/:fileId  remove a file's bytes once the client no longer lists it
 *
 * They read and write clients' data, so every request passes the shared
 * checks (`server/shared/requests.ts`) and carries `x-stylecode-workspace`.
 */

export const WORKSPACE_HEADER = 'x-stylecode-workspace';
const POLICY: RequestPolicy = { header: WORKSPACE_HEADER, feature: 'The workspace' };

/** Small JSON requests: settings, a new client, a deletion. */
const MAX_SMALL_BODY = 64 * 1024;
/** A whole workspace. 200 one-hour meetings measured 42.8 MB (ADR-0006). */
export const MAX_WORKSPACE_BODY = 100 * 1024 * 1024;
/** One attached file (Phase 1 brief, WP2). */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

type Next = (error?: unknown) => void;

/** A media type safe to send back as given, or a generic one. */
function mediaTypeOf(value: unknown): string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(value)
    ? value
    : 'application/octet-stream';
}

/** A Content-Disposition header that downloads a file under its name, with a plain fallback. */
export function attachmentHeader(name: unknown): string {
  const text = typeof name === 'string' && name.trim() ? name.trim() : 'file';
  const fallback = text.replace(/[^\x20-\x7e]|["\\%;]/g, '_');
  const encoded = encodeURIComponent(text).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export function createWorkspaceHandler(folder: DataFolder, store = new WorkspaceStore(folder.path)) {
  return async function workspaceHandler(req: IncomingMessage, res: ServerResponse, next: Next): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);
    const [section, companyId, sub, fileId, ...rest] = parts;
    if (!['info', 'settings', 'companies'].includes(section)) return next();

    const reason = rejectReason(req, POLICY);
    if (reason) return sendJson(res, 403, { error: reason });

    const method = req.method ?? 'GET';
    const notAllowed = () => sendJson(res, 405, { error: 'Method not allowed.' });

    try {
      if (section === 'info' && parts.length === 1) {
        if (method !== 'GET') return notAllowed();
        return sendJson(res, 200, { folder: folder.path, mode: folder.mode, cloudService: folder.cloudService });
      }
      if (section === 'settings' && parts.length === 1) {
        if (method === 'GET') return sendJson(res, 200, await store.readSettings());
        if (method === 'PUT') return sendJson(res, 200, await store.saveSettings(await readJson(req, MAX_SMALL_BODY)));
        return notAllowed();
      }
      if (section !== 'companies' || rest.length) return sendJson(res, 404, { error: 'Not found.' });

      if (companyId === undefined) {
        if (method === 'GET') return sendJson(res, 200, { companies: await store.list() });
        if (method === 'POST') {
          const body = await readJson(req, MAX_SMALL_BODY);
          const profile = body.profile && typeof body.profile === 'object' ? (body.profile as Record<string, unknown>) : {};
          return sendJson(res, 201, await store.create(profile));
        }
        return notAllowed();
      }
      if (!isSafeId(companyId) || (fileId !== undefined && !isSafeId(fileId))) {
        return sendJson(res, 400, { error: 'Invalid id.' });
      }

      if (sub === undefined) {
        if (method === 'GET') return sendJson(res, 200, await store.read(companyId));
        if (method === 'PUT') {
          const body = await readJson(req, MAX_WORKSPACE_BODY);
          return sendJson(res, 200, await store.save(companyId, body.workspace, body.baseRevision, body.permanent === true));
        }
        if (method === 'DELETE') {
          const body = await readJson(req, MAX_SMALL_BODY);
          await store.remove(companyId, body.confirmName);
          return sendJson(res, 200, { deleted: companyId });
        }
        return notAllowed();
      }
      if (sub !== 'files') return sendJson(res, 404, { error: 'Not found.' });

      if (fileId === undefined) {
        if (method !== 'POST') return notAllowed();
        const declared = Number(req.headers['content-length']);
        if (Number.isFinite(declared) && declared > MAX_FILE_BYTES) {
          throw new RequestError(`The file is too large. The limit is ${MAX_FILE_BYTES / 1024 / 1024} MB.`, 413);
        }
        return sendJson(res, 201, await store.addFile(companyId, req, MAX_FILE_BYTES));
      }
      if (method === 'GET') {
        const file = await store.openFile(companyId, fileId);
        res.statusCode = 200;
        res.setHeader('content-type', mediaTypeOf(file.ref.mediaType));
        res.setHeader('content-length', String(file.size));
        res.setHeader('content-disposition', attachmentHeader(file.ref.name));
        res.setHeader('x-content-type-options', 'nosniff');
        res.setHeader('content-security-policy', "default-src 'none'; sandbox");
        res.setHeader('cache-control', 'no-store');
        await pipeline(file.stream(), res);
        return;
      }
      if (method === 'DELETE') {
        await store.removeFile(companyId, fileId);
        return sendJson(res, 200, { deleted: fileId });
      }
      return notAllowed();
    } catch (error) {
      if (res.headersSent) return void res.end();
      if (error instanceof ProblemsError) return sendJson(res, error.status, { error: error.message, problems: error.problems });
      if (error instanceof RequestError) return sendJson(res, error.status, { error: error.message });
      // Unexpected errors: say what failed without echoing paths or file contents to the page.
      console.error('[stylecode workspace]', error);
      const code = (error as NodeJS.ErrnoException)?.code;
      const busy = code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
      return sendJson(res, 500, {
        error: busy
          ? "Another program is using a file in the client's folder (often antivirus or backup software). Try again in a moment."
          : "Something went wrong reading or writing the client's folder.",
      });
    }
  };
}
