import type { CompanyWorkspace } from './model/types.ts';
import type { Problem } from './model/validate.ts';

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
