import { useEffect, useState } from 'react';
import { ASSETS, idbGet, idbPut } from './idb';

/**
 * Local image storage. Images are kept in IndexedDB as blobs, keyed by a hash
 * of their content, so the same picture added twice is stored once and image
 * layers can be copied between projects. Project files embed the images they
 * use, so a saved file is self-contained.
 */

interface AssetRecord {
  id: string;
  type: string;
  blob: Blob;
  width: number;
  height: number;
}

export interface StoredAsset {
  id: string;
  width: number;
  height: number;
}

/** Largest image accepted, so a project stays quick to save and load. */
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const ASSET_ID = /^asset_[a-z0-9]{8,64}$/;

/** Object URLs of loaded images, and how many layers on screen use each. */
const urls = new Map<string, string>();
const users = new Map<string, number>();
const releases = new Map<string, ReturnType<typeof setTimeout>>();
const pending = new Map<string, Promise<string | null>>();
/** Listeners told when an image is added to storage, so layers waiting for it can show it. */
const arrivals = new Set<(id: string) => void>();

/**
 * How long an image's object URL is kept after the last layer using it goes
 * away, so undo, redo and switching back and forth don't reload it.
 */
const RELEASE_DELAY_MS = 10_000;

function retain(id: string): void {
  users.set(id, (users.get(id) ?? 0) + 1);
  clearTimeout(releases.get(id));
  releases.delete(id);
}

function scheduleRelease(id: string): void {
  clearTimeout(releases.get(id));
  releases.set(
    id,
    setTimeout(() => {
      releases.delete(id);
      if (users.get(id)) return;
      const url = urls.get(id);
      if (url) URL.revokeObjectURL(url);
      urls.delete(id);
    }, RELEASE_DELAY_MS),
  );
}

function release(id: string): void {
  const count = (users.get(id) ?? 1) - 1;
  if (count > 0) return void users.set(id, count);
  users.delete(id);
  scheduleRelease(id);
}

async function hashId(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `asset_${hex.slice(0, 32)}`;
}

async function naturalSize(blob: Blob): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { width: img.naturalWidth || 300, height: img.naturalHeight || 200 };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Stores an image file locally and returns its asset id and pixel size. */
export async function storeImage(file: Blob): Promise<StoredAsset> {
  if (!file.type.startsWith('image/')) throw new Error('That file is not an image.');
  if (file.size > MAX_IMAGE_BYTES) throw new Error('That image is larger than 15 MB. Use a smaller or compressed version.');
  const buffer = await file.arrayBuffer();
  const id = await hashId(buffer);
  const existing = await idbGet<AssetRecord>(ASSETS, id);
  if (existing) return { id, width: existing.width, height: existing.height };
  const blob = new Blob([buffer], { type: file.type });
  let size: { width: number; height: number };
  try {
    size = await naturalSize(blob);
  } catch {
    throw new Error('That image could not be read. It may be damaged or in an unsupported format.');
  }
  await idbPut<AssetRecord>(ASSETS, { id, type: file.type, blob, ...size });
  pending.delete(id); // a lookup that started before the image arrived would report it missing
  for (const listener of arrivals) listener(id);
  return { id, ...size };
}

/** An object URL for an asset, loading it from storage on first use. Null if it is missing. */
export function loadAssetUrl(id: string): Promise<string | null> {
  const cached = urls.get(id);
  if (cached) return Promise.resolve(cached);
  let request = pending.get(id);
  if (!request) {
    request = idbGet<AssetRecord>(ASSETS, id)
      .then((record) => {
        if (!record) return null;
        const url = urls.get(id) ?? URL.createObjectURL(record.blob);
        urls.set(id, url);
        if (!users.get(id)) scheduleRelease(id);
        return url;
      })
      .catch(() => null)
      .finally(() => {
        if (pending.get(id) === request) pending.delete(id);
      });
    pending.set(id, request);
  }
  return request;
}

/** React hook: the displayable URL for an asset id, or null while loading or if missing. */
export function useAssetUrl(id: string): { url: string | null; missing: boolean } {
  const [state, setState] = useState<{ url: string | null; missing: boolean }>(() => ({
    url: id ? (urls.get(id) ?? null) : null,
    missing: !id,
  }));
  useEffect(() => {
    if (!id) return setState({ url: null, missing: true });
    let alive = true;
    retain(id);
    let latest = 0;
    const load = () => {
      const request = ++latest;
      void loadAssetUrl(id).then((url) => alive && request === latest && setState({ url, missing: url === null }));
    };
    load();
    // A missing image may arrive later (added again, or opened in a project file).
    const onArrival = (arrived: string) => arrived === id && load();
    arrivals.add(onArrival);
    return () => {
      alive = false;
      arrivals.delete(onArrival);
      release(id);
    };
  }, [id]);
  return state;
}

// ---------------------------------------------------------------------------
// Embedding in project files
// ---------------------------------------------------------------------------

export interface EmbeddedAsset {
  type: string;
  /** Base64-encoded file content. */
  data: string;
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Reads the given assets for embedding in a project file. Missing assets are skipped. */
export async function exportAssets(ids: Iterable<string>): Promise<Record<string, EmbeddedAsset>> {
  const out: Record<string, EmbeddedAsset> = {};
  for (const id of new Set(ids)) {
    const record = await idbGet<AssetRecord>(ASSETS, id);
    if (record) out[id] = { type: record.type, data: toBase64(await record.blob.arrayBuffer()) };
  }
  return out;
}

/** Stores images embedded in a project file. Invalid entries are ignored; returns how many were stored. */
export async function importAssets(assets: unknown): Promise<number> {
  if (!assets || typeof assets !== 'object') return 0;
  let stored = 0;
  for (const [id, value] of Object.entries(assets as Record<string, unknown>)) {
    const entry = value as Partial<EmbeddedAsset> | null;
    if (
      !ASSET_ID.test(id) ||
      typeof entry?.type !== 'string' ||
      !entry.type.startsWith('image/') ||
      typeof entry.data !== 'string'
    ) {
      continue;
    }
    try {
      const binary = atob(entry.data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      // Re-hash rather than trusting the file's id, so a mislabelled asset cannot replace another.
      const asset = await storeImage(new Blob([bytes], { type: entry.type }));
      if (asset.id === id) stored++;
    } catch {
      // A damaged image is skipped; its layers show a placeholder.
    }
  }
  return stored;
}
