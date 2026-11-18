import type { CompanyWorkspace } from './model/types.ts';
import type { Problem } from './model/validate.ts';
import type { JobResult, JobView, LeaseView, TranscriptionStatus } from './transcription/types.ts';

/**
 * The browser's side of the local workspace server (`server/workspace`). Every
 * request carries the workspace header, which the server requires.
 */

const BASE = '/api/workspace';
const HEADERS = { 'content-type': 'application/json', 'x-stylecode-workspace': '1' };

export class WorkspaceApiError extends Error {
  constructor(
    message: string,
    /** The HTTP status, or 0 when the server couldn't be reached. */
    readonly status: number,
    readonly problems: Problem[] = [],
  ) {
    super(message);
  }

  /** Whether trying the same request again later may work: the server was unreachable, busy or failed. */
  get retryable(): boolean {
    return this.status === 0 || this.status >= 500;
  }
}

export interface WorkspaceInfo {
  folder: string;
  mode: 'start' | 'development';
  /** The cloud service syncing the folder, if any (ADR-0009). */
  cloudService: string | null;
}

export interface Settings {
  consultantName: string | null;
}

export interface CompanySummary {
  id: string;
  /** Null when the client's file can't be read at all. */
  name: string | null;
  industry: string;
  changedAt: string;
  access: 'editable' | 'read-only' | 'unreadable';
  activeEngagements: number;
}

export interface OpenedCompany {
  workspace: CompanyWorkspace;
  access: 'editable' | 'read-only';
  problems: Problem[];
  revision: string;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, { ...init, headers: HEADERS });
  } catch {
    throw new WorkspaceApiError('StyleCode’s local server isn’t reachable. Is the window where it runs still open?', 0);
  }
  const body = (await response.json().catch(() => null)) as (T & { error?: string; problems?: Problem[] }) | null;
  if (!response.ok || !body) {
    throw new WorkspaceApiError(
      body?.error ?? `StyleCode’s local server returned an error (${response.status}).`,
      response.status,
      body?.problems ?? [],
    );
  }
  return body;
}

/**
 * The data folder in use, or null when no workspace server is running (the
 * GitHub Pages demo, or any static build), so the app opens on the editor.
 */
export async function getWorkspaceInfo(): Promise<WorkspaceInfo | null> {
  try {
    const info = await request<WorkspaceInfo>('/info');
    return typeof info.folder === 'string' ? info : null;
  } catch {
    return null;
  }
}

export const getSettings = () => request<Settings>('/settings');

export const saveSettings = (update: Partial<Settings>) =>
  request<Settings>('/settings', { method: 'PUT', body: JSON.stringify(update) });

export const listCompanies = () => request<{ companies: CompanySummary[] }>('/companies').then((r) => r.companies);

export const createCompany = (profile: { name: string; industry?: string }) =>
  request<OpenedCompany>('/companies', { method: 'POST', body: JSON.stringify({ profile }) });

export const openCompany = (id: string) => request<OpenedCompany>(`/companies/${encodeURIComponent(id)}`);

export const saveCompany = (id: string, workspace: CompanyWorkspace, baseRevision: string, permanent: boolean) =>
  request<{ revision: string }>(`/companies/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify({ workspace, baseRevision, permanent }),
  });

/** Deletes a client and everything in it. The server checks the name again, as a second safeguard. */
export const deleteCompany = (id: string, confirmName: string) =>
  request<{ deleted: string }>(`/companies/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    body: JSON.stringify({ confirmName }),
  });

export type WorkspaceApi = {
  saveCompany: typeof saveCompany;
};

/** Stores a file's bytes in the client's folder, giving the id the app then lists it under. Nothing reads the contents. */
export async function uploadFile(companyId: string, file: Blob): Promise<{ id: string; sizeBytes: number }> {
  let response: Response;
  try {
    response = await fetch(`${BASE}/companies/${encodeURIComponent(companyId)}/files`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', 'x-stylecode-workspace': '1' },
      body: file,
    });
  } catch {
    throw new WorkspaceApiError('StyleCode’s local server isn’t reachable. Is the window where it runs still open?', 0);
  }
  const body = (await response.json().catch(() => null)) as { id?: string; sizeBytes?: number; error?: string } | null;
  if (!response.ok || !body?.id)
    throw new WorkspaceApiError(body?.error ?? `The file couldn’t be stored (${response.status}).`, response.status);
  return { id: body.id, sizeBytes: body.sizeBytes ?? file.size };
}

/**
 * A file's bytes, typed as a download so the browser never shows them as a
 * page (Phase 1 brief, WP10): a stored HTML or SVG file opened in place would
 * run as StyleCode's own page, with access to the workspace API.
 */
export async function downloadFile(companyId: string, fileId: string): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(`${BASE}/companies/${encodeURIComponent(companyId)}/files/${encodeURIComponent(fileId)}`, {
      headers: { 'x-stylecode-workspace': '1' },
    });
  } catch {
    throw new WorkspaceApiError('StyleCode’s local server isn’t reachable. Is the window where it runs still open?', 0);
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new WorkspaceApiError(body?.error ?? `The file couldn’t be read (${response.status}).`, response.status);
  }
  return new Blob([await response.arrayBuffer()], { type: 'application/octet-stream' });
}

/** A request with a binary body (sound), answered with JSON. */
async function binary<T>(path: string, method: string, body: Blob | Uint8Array | null): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers: { 'content-type': 'application/octet-stream', 'x-stylecode-workspace': '1' },
      body: body as BodyInit | null,
    });
  } catch {
    throw new WorkspaceApiError('StyleCode’s local server isn’t reachable. Is the window where it runs still open?', 0);
  }
  const answer = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !answer)
    throw new WorkspaceApiError(
      answer?.error ?? `StyleCode’s local server returned an error (${response.status}).`,
      response.status,
    );
  return answer;
}

const company = (id: string) => `/companies/${encodeURIComponent(id)}`;

/** Makes a new recording's file (Phase 3, decision 12), giving its id and the free space. */
export const startRecordingFile = (companyId: string) =>
  binary<{ id: string; freeBytes: number; lowSpace: boolean }>(`${company(companyId)}/recordings`, 'POST', null);

/** Writes a piece of sound at its offset; a piece sent twice is written once. */
export const sendRecordingPiece = (companyId: string, fileId: string, sessionId: string, offset: number, piece: Uint8Array) =>
  binary<{ bytes: number; full: boolean }>(
    `${company(companyId)}/recordings/${encodeURIComponent(fileId)}?session=${encodeURIComponent(sessionId)}&offset=${offset}`,
    'PUT',
    piece,
  );

/** Finishes a recording's file; `recover` for one a crash left unfinished. */
export const finishRecordingFile = (companyId: string, fileId: string, recover = false) =>
  binary<{ sizeBytes: number; durationMs: number }>(
    `${company(companyId)}/recordings/${encodeURIComponent(fileId)}/finish${recover ? '?recover=1' : ''}`,
    'POST',
    null,
  );

/** Converts and stores a WAV made elsewhere (decision 15). */
export const addWavFile = (companyId: string, sessionId: string, file: Blob) =>
  binary<{ id: string; sizeBytes: number; durationMs: number }>(
    `${company(companyId)}/added-recordings?session=${encodeURIComponent(sessionId)}`,
    'POST',
    file,
  );

/** Removes stored bytes the client never came to list (a recording whose start couldn't be saved). */
export const discardStoredFile = (companyId: string, fileId: string) =>
  request<{ deleted: string }>(`${company(companyId)}/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });

// ---------------------------------------------------------------------------
// Transcription on this computer (Phase 3 brief, WP7; decisions 10 and 17)
// ---------------------------------------------------------------------------

const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

/** What's installed, the versions, the GPU, past speeds, and any job going. */
export const getTranscriptionStatus = () => request<TranscriptionStatus>('/transcription');

/** A client's transcriptions: those going or ended since the server started, and results kept until added or discarded. */
export const listTranscriptions = (companyId: string) =>
  request<{ jobs: JobView[] }>(`${company(companyId)}/transcriptions`).then((r) => r.jobs);

/** Starts transcribing a session's recordings, in order. */
export const startTranscription = (companyId: string, sessionId: string, recordingIds: readonly string[]) =>
  request<JobView>(`${company(companyId)}/transcriptions`, json({ sessionId, recordingIds }));

export const getTranscription = (companyId: string, jobId: string) =>
  request<JobView>(`${company(companyId)}/transcriptions/${encodeURIComponent(jobId)}`);

/** Stops a transcription; nothing it made is kept. */
export const cancelTranscription = (companyId: string, jobId: string) =>
  request<JobView>(`${company(companyId)}/transcriptions/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' });

/** Starts a transcription waiting for the graphics card to cool, without waiting any longer (decision 10). */
export const startTranscriptionNow = (companyId: string, jobId: string) =>
  request<JobView>(`${company(companyId)}/transcriptions/${encodeURIComponent(jobId)}/start-now`, { method: 'POST' });

/** A finished transcription's segments, speakers and what made them. */
export const transcriptionResult = (companyId: string, jobId: string) =>
  request<JobResult>(`${company(companyId)}/transcriptions/${encodeURIComponent(jobId)}/result`);

/** Discards a transcription's result: once it is added, or when the consultant doesn't want it. */
export const discardTranscription = (companyId: string, jobId: string) =>
  request<{ deleted: string }>(`${company(companyId)}/transcriptions/${encodeURIComponent(jobId)}`, { method: 'DELETE' });

/** Takes the heavy slot for an AI run on this computer (decision 10): it runs, or waits for a transcription. */
export const takeHeavySlot = () => request<LeaseView>('/heavy', json({ kind: 'extraction' }));

/** Whether the AI run's slot runs or still waits; asking keeps it. */
export const checkHeavySlot = (leaseId: string) => request<LeaseView>(`/heavy/${encodeURIComponent(leaseId)}`);

export const releaseHeavySlot = (leaseId: string) =>
  request<{ released: string }>(`/heavy/${encodeURIComponent(leaseId)}`, { method: 'DELETE' });

// Designs (Phase 4, decisions 2, 3 and 8): an engagement's designs, in the company's folder.

export interface DesignSummary {
  documentId: string;
  /** Why it can't be opened: missing, damaged or from a newer StyleCode. */
  problem: string | null;
  sizeBytes: number;
}

const designPath = (companyId: string, documentId?: string) =>
  `/companies/${encodeURIComponent(companyId)}/designs${documentId === undefined ? '' : `/${encodeURIComponent(documentId)}`}`;

export const listDesigns = (companyId: string) =>
  request<{ designs: DesignSummary[] }>(designPath(companyId)).then((r) => r.designs);

/** Creates a design's file, new or copied; never overwrites. The app lists it in the workspace afterwards. */
export const createDesignFile = (companyId: string, documentId: string, file: unknown) =>
  request<{ revision: string }>(designPath(companyId), json({ documentId, file }));

export const readDesignFile = (companyId: string, documentId: string) =>
  request<{ file: unknown; revision: string }>(designPath(companyId, documentId));

export const saveDesignFile = (companyId: string, documentId: string, file: unknown, baseRevision: string) =>
  request<{ revision: string }>(designPath(companyId, documentId), { ...json({ file, baseRevision }), method: 'PUT' });

/** A design's file exactly as stored, as a download (decision 7). */
export async function downloadDesignFile(companyId: string, documentId: string): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${designPath(companyId, documentId)}/file`, { headers: { 'x-stylecode-workspace': '1' } });
  } catch {
    throw new WorkspaceApiError('StyleCode’s local server isn’t reachable. Is the window where it runs still open?', 0);
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new WorkspaceApiError(body?.error ?? `The design couldn’t be read (${response.status}).`, response.status);
  }
  return new Blob([await response.arrayBuffer()], { type: 'application/octet-stream' });
}

/** Stores an image in the company named, under the id its bytes hash to. */
export async function uploadDesignAsset(companyId: string, image: Blob): Promise<{ id: string }> {
  let response: Response;
  try {
    response = await fetch(`${BASE}/companies/${encodeURIComponent(companyId)}/design-assets`, {
      method: 'POST',
      headers: { 'content-type': image.type, 'x-stylecode-workspace': '1' },
      body: image,
    });
  } catch {
    throw new WorkspaceApiError('StyleCode’s local server isn’t reachable. Is the window where it runs still open?', 0);
  }
  const body = (await response.json().catch(() => null)) as { id?: string; error?: string } | null;
  if (!response.ok || !body?.id)
    throw new WorkspaceApiError(body?.error ?? `The image couldn’t be stored (${response.status}).`, response.status);
  return { id: body.id };
}

/** An image of the company's designs, or null if it has none by that id. */
export async function downloadDesignAsset(companyId: string, assetId: string): Promise<Blob | null> {
  let response: Response;
  try {
    response = await fetch(`${BASE}/companies/${encodeURIComponent(companyId)}/design-assets/${encodeURIComponent(assetId)}`, {
      headers: { 'x-stylecode-workspace': '1' },
    });
  } catch {
    throw new WorkspaceApiError('StyleCode’s local server isn’t reachable. Is the window where it runs still open?', 0);
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new WorkspaceApiError(`The image couldn’t be read (${response.status}).`, response.status);
  const type = response.headers.get('content-type') ?? 'application/octet-stream';
  return new Blob([await response.arrayBuffer()], { type });
}
