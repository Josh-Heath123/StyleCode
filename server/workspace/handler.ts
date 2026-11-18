import type { IncomingMessage, ServerResponse } from 'node:http';
import { pipeline } from 'node:stream/promises';
import { MAX_ADDED_WAV_BYTES } from '../../src/workspace/model/recordings.ts';
import { readBody, readJson, rejectReason, RequestError, sendJson, type RequestPolicy } from '../shared/requests.ts';
import type { DataFolder } from './folder.ts';
import { MAX_PIECE_BYTES, RecordingFiles } from './recordings.ts';
import { heavyLeases as sharedLeases, type HeavyLeases } from '../shared/heavy.ts';
import { TranscriptionJobs } from '../transcription/jobs.ts';
import { transcriptionStatus } from '../transcription/status.ts';
import { isSafeId, ProblemsError, WorkspaceStore } from './store.ts';
import { DesignFiles, MAX_DESIGN_BYTES, MAX_IMAGE_BYTES } from './designs.ts';

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
 *   POST   /api/workspace/companies/:id/recordings     start a recording's file, giving its id and the free space
 *   PUT    /api/workspace/companies/:id/recordings/:fileId?session=…&offset=…   write a piece of sound (the body)
 *   POST   /api/workspace/companies/:id/recordings/:fileId/finish[?recover=1]   write its header, giving size and length
 *   POST   /api/workspace/companies/:id/added-recordings?session=…  convert and store a WAV made elsewhere (the body), if consent allows
 *   GET    /api/workspace/companies/:id/designs        the client's designs, each with whether it can be opened
 *   POST   /api/workspace/companies/:id/designs        create a design's file { documentId, file }; never overwrites
 *   GET    /api/workspace/companies/:id/designs/:docId          a listed design: { file, revision }
 *   PUT    /api/workspace/companies/:id/designs/:docId          save it { file, baseRevision }
 *   GET    /api/workspace/companies/:id/designs/:docId/file     download it exactly as stored
 *   POST   /api/workspace/companies/:id/design-assets           store an image (the body), giving its content-hash id
 *   GET    /api/workspace/companies/:id/design-assets/:assetId  an image of the client's designs
 *   GET    /api/workspace/transcription                what's installed, the versions, the GPU, and any job going
 *   POST   /api/workspace/heavy                        take the heavy slot for an AI run { kind: 'extraction' } (decision 10)
 *   GET    /api/workspace/heavy/:leaseId               whether it runs or waits, and for what; keeps the lease
 *   DELETE /api/workspace/heavy/:leaseId               let the slot go
 *   GET    /api/workspace/companies/:id/transcriptions  the client's jobs, and results kept until added or discarded
 *   POST   /api/workspace/companies/:id/transcriptions  transcribe { sessionId, recordingIds }
 *   GET    /api/workspace/companies/:id/transcriptions/:jobId          a job's state and progress
 *   POST   /api/workspace/companies/:id/transcriptions/:jobId/cancel   stop it, keeping nothing
 *   POST   /api/workspace/companies/:id/transcriptions/:jobId/start-now  start without waiting for the GPU to cool
 *   GET    /api/workspace/companies/:id/transcriptions/:jobId/result   its segments
 *   DELETE /api/workspace/companies/:id/transcriptions/:jobId          discard its result
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

export function createWorkspaceHandler(
  folder: DataFolder,
  store = new WorkspaceStore(folder.path),
  recordings = new RecordingFiles(store),
  transcriptions = new TranscriptionJobs(store),
  leases: HeavyLeases = sharedLeases,
  designs = new DesignFiles(store),
) {
  // A recording left unfinished by a crash gets its header now; the app marks it recovered when the client opens.
  void recordings.closeUnfinished().catch(() => undefined);
  // A transcription the server stopped mid-way left working files; they go (decision 17).
  void transcriptions.clearLeftovers().catch(() => undefined);
  return async function workspaceHandler(req: IncomingMessage, res: ServerResponse, next: Next): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);
    const [section, companyId, sub, fileId, ...rest] = parts;
    if (!['info', 'settings', 'companies', 'transcription', 'heavy'].includes(section)) return next();

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
      if (section === 'transcription' && parts.length === 1) {
        if (method !== 'GET') return notAllowed();
        return sendJson(res, 200, await transcriptionStatus(transcriptions.busy()));
      }
      if (section === 'heavy' && parts.length <= 2) {
        const leaseId = parts[1];
        if (leaseId === undefined) {
          if (method !== 'POST') return notAllowed();
          const body = await readJson(req, MAX_SMALL_BODY);
          if (body.kind !== 'extraction') return sendJson(res, 400, { error: 'Only an AI run takes the slot from the page.' });
          return sendJson(res, 201, leases.take('extraction'));
        }
        if (!/^hl_[0-9a-f]{16}$/.test(leaseId)) return sendJson(res, 400, { error: 'Invalid id.' });
        if (method === 'GET') {
          const lease = leases.check(leaseId);
          return lease ? sendJson(res, 200, lease) : sendJson(res, 404, { error: 'The slot was let go.' });
        }
        if (method === 'DELETE') {
          leases.release(leaseId);
          return sendJson(res, 200, { released: leaseId });
        }
        return notAllowed();
      }
      const finishing = sub === 'recordings' && rest.length === 1 && rest[0] === 'finish';
      const jobAction =
        sub === 'transcriptions' && rest.length === 1 && ['result', 'cancel', 'start-now'].includes(rest[0]) ? rest[0] : null;
      const designFile = sub === 'designs' && rest.length === 1 && rest[0] === 'file';
      if (section !== 'companies' || (rest.length && !finishing && !jobAction && !designFile))
        return sendJson(res, 404, { error: 'Not found.' });

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
          // A transcription of the client stops first: its programs hold files in the client's folder.
          await transcriptions.stopCompany(companyId);
          await store.remove(companyId, body.confirmName);
          return sendJson(res, 200, { deleted: companyId });
        }
        return notAllowed();
      }
      if (sub === 'recordings') {
        if (fileId === undefined) {
          if (method !== 'POST') return notAllowed();
          return sendJson(res, 201, await recordings.start(companyId));
        }
        if (finishing) {
          if (method !== 'POST') return notAllowed();
          return sendJson(res, 200, await recordings.finish(companyId, fileId, url.searchParams.get('recover') === '1'));
        }
        if (method !== 'PUT') return notAllowed();
        const sessionId = url.searchParams.get('session');
        if (!isSafeId(sessionId)) return sendJson(res, 400, { error: 'Invalid id.' });
        const offset = Number(url.searchParams.get('offset'));
        const piece = await readBody(req, MAX_PIECE_BYTES);
        return sendJson(res, 200, await recordings.append(companyId, fileId, sessionId, offset, piece));
      }
      if (sub === 'transcriptions') {
        if (fileId === undefined) {
          if (method === 'GET') return sendJson(res, 200, { jobs: await transcriptions.list(companyId) });
          if (method !== 'POST') return notAllowed();
          const body = await readJson(req, MAX_SMALL_BODY);
          return sendJson(res, 201, await transcriptions.start(companyId, body.sessionId, body.recordingIds));
        }
        if (jobAction === 'result') {
          if (method !== 'GET') return notAllowed();
          return sendJson(res, 200, await transcriptions.result(companyId, fileId));
        }
        if (jobAction === 'cancel') {
          if (method !== 'POST') return notAllowed();
          return sendJson(res, 200, transcriptions.cancel(companyId, fileId));
        }
        if (jobAction === 'start-now') {
          if (method !== 'POST') return notAllowed();
          return sendJson(res, 200, transcriptions.startNow(companyId, fileId));
        }
        if (method === 'GET') return sendJson(res, 200, transcriptions.get(companyId, fileId));
        if (method === 'DELETE') {
          await transcriptions.discard(companyId, fileId);
          return sendJson(res, 200, { deleted: fileId });
        }
        return notAllowed();
      }
      if (sub === 'added-recordings') {
        if (fileId !== undefined) return sendJson(res, 404, { error: 'Not found.' });
        if (method !== 'POST') return notAllowed();
        const declared = Number(req.headers['content-length']);
        if (Number.isFinite(declared) && declared > MAX_ADDED_WAV_BYTES)
          throw new RequestError('The file is too large. The limit is 2 GB.', 413);
        const forSession = url.searchParams.get('session');
        if (!isSafeId(forSession)) return sendJson(res, 400, { error: 'Invalid id.' });
        return sendJson(res, 201, await recordings.addWav(companyId, forSession, req));
      }
      if (sub === 'designs') {
        if (fileId === undefined) {
          if (method === 'GET') return sendJson(res, 200, { designs: await designs.list(companyId) });
          if (method !== 'POST') return notAllowed();
          const body = await readJson(req, MAX_DESIGN_BYTES + MAX_SMALL_BODY);
          return sendJson(res, 201, await designs.create(companyId, body.documentId, body.file));
        }
        if (designFile) {
          if (method !== 'GET') return notAllowed();
          const bytes = await designs.raw(companyId, fileId);
          res.statusCode = 200;
          res.setHeader('content-type', 'application/json');
          res.setHeader('content-length', String(bytes.length));
          res.setHeader('content-disposition', attachmentHeader(`${fileId}.stylecode.json`));
          res.setHeader('x-content-type-options', 'nosniff');
          res.setHeader('content-security-policy', "default-src 'none'; sandbox");
          res.setHeader('cache-control', 'no-store');
          return void res.end(bytes);
        }
        if (method === 'GET') return sendJson(res, 200, await designs.read(companyId, fileId));
        if (method === 'PUT') {
          const body = await readJson(req, MAX_DESIGN_BYTES + MAX_SMALL_BODY);
          return sendJson(res, 200, await designs.save(companyId, fileId, body.file, body.baseRevision));
        }
        return notAllowed();
      }
      if (sub === 'design-assets') {
        if (fileId === undefined) {
          if (method !== 'POST') return notAllowed();
          const bytes = await readBody(req, MAX_IMAGE_BYTES);
          return sendJson(res, 201, await designs.addAsset(companyId, bytes, req.headers['content-type']));
        }
        if (method !== 'GET') return notAllowed();
        const image = await designs.openAsset(companyId, fileId);
        res.statusCode = 200;
        res.setHeader('content-type', image.type);
        res.setHeader('content-length', String(image.bytes.length));
        res.setHeader('content-disposition', attachmentHeader(fileId));
        res.setHeader('x-content-type-options', 'nosniff');
        res.setHeader('content-security-policy', "default-src 'none'; sandbox");
        res.setHeader('cache-control', 'no-store');
        return void res.end(image.bytes);
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
