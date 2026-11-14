import { open, readdir, readFile, rm, stat, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { readWavHeader, WavConverter, WavError, wavHeader, WAV_HEADER_BYTES } from '../../src/workspace/audio/wav.ts';
import { consentFor, consentState } from '../../src/workspace/model/consent.ts';
import type { CompanyWorkspace } from '../../src/workspace/model/index.ts';
import {
  durationOfBytes,
  isRecording,
  MAX_ADDED_WAV_BYTES,
  MAX_RECORDING_MS,
  RECORDING_BYTES_PER_SECOND,
  RECORDING_SAMPLE_RATE,
} from '../../src/workspace/model/recordings.ts';
import { createId } from '../../src/model/ids.ts';
import { renameWithRetry } from '../shared/rename.ts';
import { RequestError } from '../shared/requests.ts';
import { isSafeId, type WorkspaceStore } from './store.ts';

/**
 * Recordings on disk (Phase 3 brief, decision 12 and "Clarifications"). A
 * recording is a 16 kHz mono 16-bit WAV in the company's `files` folder,
 * under the id of its FileRef:
 *
 * - **Starting** makes the file, with a header whose sizes are filled in when
 *   it finishes. The app then lists it in the workspace (`startRecording`).
 * - **Pieces** of sound arrive every few seconds and are written at their
 *   offset, so a piece sent twice isn't written twice. Each is flushed to
 *   disk, so a crash or a closed tab loses at most the last few seconds. A
 *   piece is taken only for a recording the saved workspace lists as still
 *   recording, in the session named, while consent allows recording.
 * - **Finishing** writes the header's sizes. At start-up, a recording left
 *   unfinished by a crash gets its header too, and the app marks it recovered.
 * - **Adding a WAV** made elsewhere converts it, as it streams in, to the
 *   same format (decision 15).
 *
 * Nothing here logs or returns what was said: only sizes and lengths.
 */

const GB = 1024 ** 3;
/** Below this, a recording doesn't start (decision 12): an hour is about 115 MB. */
export const MIN_FREE_BYTES = 1 * GB;
/** Below this, starting warns. */
export const LOW_FREE_BYTES = 5 * GB;
/** The largest piece of sound one request may carry: about 30 seconds. */
export const MAX_PIECE_BYTES = 1024 * 1024;
/** The most sound a recording holds: 4 hours (decision 13). */
export const MAX_SOUND_BYTES = (MAX_RECORDING_MS / 1000) * RECORDING_BYTES_PER_SECOND;
/** A recording written to this recently is still going in some window, so it isn't recovered. */
export const LIVE_MS = 15_000;

export interface RecordingOptions {
  /** For tests: free bytes on the data folder's drive. */
  freeBytes?: (path: string) => Promise<number>;
  /** For tests: the current time, in milliseconds. */
  now?: () => number;
}

export class RecordingFiles {
  /** Recordings checked against the saved workspace, with the workspace file's time when they were. */
  private readonly checked = new Map<string, { changed: number; sessionId: string }>();
  /** One write at a time per recording. */
  private readonly writes = new Map<string, Promise<unknown>>();

  constructor(
    private readonly store: WorkspaceStore,
    private readonly options: RecordingOptions = {},
  ) {}

  private path(companyId: string, fileId: string): string {
    if (!isSafeId(fileId)) throw new RequestError('Invalid id.', 400);
    return join(this.store.companyFolder(companyId), 'files', fileId);
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  /** Free bytes on the drive that holds the data folder. */
  async freeBytes(companyId: string): Promise<number> {
    const folder = this.store.companyFolder(companyId);
    if (this.options.freeBytes) return this.options.freeBytes(folder);
    const s = await statfs(folder);
    return s.bavail * s.bsize;
  }

  private async checkSpace(companyId: string): Promise<{ freeBytes: number; lowSpace: boolean }> {
    const freeBytes = await this.freeBytes(companyId);
    if (freeBytes < MIN_FREE_BYTES)
      throw new RequestError(
        'Under 1 GB is free on the drive that holds your StyleCode data, so recording can’t start. An hour of recording takes about 115 MB. Free some space first.',
        507,
      );
    return { freeBytes, lowSpace: freeBytes < LOW_FREE_BYTES };
  }

  /** Makes a new recording's file, empty but for its header, and says how much space is left. */
  async start(companyId: string): Promise<{ id: string; freeBytes: number; lowSpace: boolean }> {
    const space = await this.checkSpace(companyId);
    const id = createId('fi');
    await this.store.inQueue(companyId, async () => {
      await this.store.read(companyId).then((opened) => {
        if (opened.access !== 'editable')
          throw new RequestError("This client's file has problems, so nothing can be recorded to it.", 409);
      });
      const handle = await open(this.path(companyId, id), 'wx', 0o600);
      try {
        await handle.write(wavHeader(0, RECORDING_SAMPLE_RATE), 0, WAV_HEADER_BYTES, 0);
        await handle.sync();
      } finally {
        await handle.close();
      }
      this.store.keepUpload(companyId, id);
    });
    return { id, ...space };
  }

  /** Runs writes to one recording one after another. */
  private oneAtATime<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.writes.get(key) ?? Promise.resolve();
    const next = previous.then(task, task);
    const settled = next.catch(() => undefined);
    this.writes.set(key, settled);
    void settled.then(() => {
      if (this.writes.get(key) === settled) this.writes.delete(key);
    });
    return next;
  }

  /**
   * Whether the saved workspace lists this recording as still recording, in
   * this session, with consent to recording now. Checked again whenever the
   * workspace file changes, so a withdrawal or a deletion stops the pieces.
   */
  private async checkListed(companyId: string, fileId: string, sessionId: string): Promise<void> {
    const key = `${companyId}/${fileId}`;
    const workspaceFile = join(this.store.companyFolder(companyId), 'workspace.json');
    const changed = await stat(workspaceFile).then(
      (s) => s.mtimeMs,
      () => -1,
    );
    const known = this.checked.get(key);
    if (known && known.changed === changed && known.sessionId === sessionId) return;
    const { workspace } = await this.store.read(companyId);
    const problem = recordingProblem(workspace, fileId, sessionId);
    if (problem) {
      this.checked.delete(key);
      throw new RequestError(problem, 409);
    }
    this.checked.set(key, { changed, sessionId });
  }

  /**
   * Writes a piece of sound at its offset (bytes from the start of the
   * sound). A piece already written, wholly or in part, is written only from
   * where the file ends; a piece after a gap is refused, saying where the
   * file ends. Sound past 4 hours is dropped, and `full` says so.
   */
  async append(
    companyId: string,
    fileId: string,
    sessionId: string,
    offset: number,
    piece: Buffer,
  ): Promise<{ bytes: number; full: boolean }> {
    if (!Number.isInteger(offset) || offset < 0 || offset % 2) throw new RequestError('Invalid offset.', 400);
    if (piece.length % 2) throw new RequestError('A piece of sound is whole 16-bit samples.', 400);
    await this.checkListed(companyId, fileId, sessionId);
    const path = this.path(companyId, fileId);
    return this.oneAtATime(`${companyId}/${fileId}`, async () => {
      const handle = await open(path, 'r+').catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') throw new RequestError('The recording’s file is missing.', 404);
        throw error;
      });
      try {
        const size = (await handle.stat()).size;
        const written = Math.max(0, size - WAV_HEADER_BYTES);
        if (offset > written) throw new RequestError(`A piece is missing: the recording has ${written} bytes.`, 409);
        const fresh = piece.subarray(Math.min(piece.length, written - offset));
        const room = Math.max(0, MAX_SOUND_BYTES - written);
        const take = fresh.subarray(0, Math.min(fresh.length, room));
        if (take.length) {
          await handle.write(take, 0, take.length, WAV_HEADER_BYTES + written);
          await handle.sync();
        }
        const bytes = written + take.length;
        return { bytes, full: bytes >= MAX_SOUND_BYTES };
      } finally {
        await handle.close();
      }
    });
  }

  /**
   * Writes the header's sizes once a recording stops, and gives its size and
   * length. With `recover`, for a recording found unfinished, it refuses one
   * written to in the last few seconds: another window is still recording it.
   */
  async finish(companyId: string, fileId: string, recover: boolean): Promise<{ sizeBytes: number; durationMs: number }> {
    const { workspace } = await this.store.read(companyId);
    const file = workspace.files[fileId];
    if (!Object.hasOwn(workspace.files, fileId) || !isRecording(file)) throw new RequestError('There is no such recording.', 404);
    const path = this.path(companyId, fileId);
    return this.oneAtATime(`${companyId}/${fileId}`, async () => {
      const info = await stat(path).catch(() => null);
      if (!info) throw new RequestError('The recording’s file is missing.', 404);
      if (recover && file.audio.state === 'recording' && this.now() - info.mtimeMs < LIVE_MS)
        throw new RequestError('This recording is still going in another window.', 409);
      const sound = await writeSizes(path);
      this.checked.delete(`${companyId}/${fileId}`);
      return { sizeBytes: WAV_HEADER_BYTES + sound, durationMs: durationOfBytes(sound) };
    });
  }

  /**
   * At start-up: writes the header of every recording a saved workspace
   * still lists as recording and that nothing has written to for a while,
   * so the file is whole even before the app marks it recovered.
   */
  async closeUnfinished(): Promise<number> {
    let closed = 0;
    const companies = join(this.store.root, 'companies');
    for (const id of await readdir(companies).catch(() => [] as string[])) {
      if (!isSafeId(id)) continue;
      let workspace: CompanyWorkspace;
      try {
        workspace = (await this.store.read(id)).workspace;
      } catch {
        continue;
      }
      for (const file of Object.values(workspace.files)) {
        if (!isRecording(file) || file.audio.state !== 'recording' || !isSafeId(file.id)) continue;
        const path = this.path(id, file.id);
        const info = await stat(path).catch(() => null);
        if (!info || this.now() - info.mtimeMs < LIVE_MS) continue;
        await this.oneAtATime(`${id}/${file.id}`, () => writeSizes(path)).then(
          () => closed++,
          () => undefined,
        );
      }
    }
    return closed;
  }

  /**
   * Adds a WAV made elsewhere (decision 15): 16-bit or float, any rate, mono
   * or stereo, up to 2 GB and 4 hours. It is converted to 16 kHz mono as it
   * streams in, and stored under a new id for the app to list.
   */
  async addWav(
    companyId: string,
    source: AsyncIterable<Buffer>,
    maxBytes = MAX_ADDED_WAV_BYTES,
  ): Promise<{ id: string; sizeBytes: number; durationMs: number }> {
    await this.checkSpace(companyId);
    const id = createId('fi');
    const dir = join(this.store.companyFolder(companyId), 'files');
    const temp = join(dir, `${id}.tmp`);
    const handle = await this.store.inQueue(companyId, async () => {
      const opened = await this.store.read(companyId);
      if (opened.access !== 'editable')
        throw new RequestError("This client's file has problems, so nothing can be added to it.", 409);
      this.store.keepUpload(companyId, id);
      return open(temp, 'wx', 0o600);
    });
    try {
      let received = 0;
      let head = Buffer.alloc(0);
      let converter: WavConverter | null = null;
      let sound = 0;
      const write = async (bytes: Uint8Array) => {
        if (!bytes.length) return;
        if (sound + bytes.length > MAX_SOUND_BYTES) throw new RequestError('A recording is at most 4 hours long.', 413);
        await handle.write(bytes, 0, bytes.length, WAV_HEADER_BYTES + sound);
        sound += bytes.length;
      };
      for await (const chunk of source) {
        received += chunk.length;
        if (received > maxBytes) throw new RequestError('The file is too large. The limit is 2 GB.', 413);
        if (converter) {
          await write(converter.push(chunk));
          continue;
        }
        head = Buffer.concat([head, chunk]);
        const format = readWavHeader(head);
        if (!format) continue;
        const frame = (format.encoding === 'int16' ? 2 : 4) * format.channels;
        if (format.dataBytes !== null && (format.dataBytes / frame / format.sampleRate) * 1000 > MAX_RECORDING_MS)
          throw new RequestError('A recording is at most 4 hours long.', 413);
        converter = new WavConverter(format, RECORDING_SAMPLE_RATE);
        await write(converter.push(head.subarray(format.dataOffset)));
        head = Buffer.alloc(0);
      }
      if (!converter) throw new RequestError('This isn’t a WAV file StyleCode can read.', 400);
      await write(converter.finish());
      if (!sound) throw new RequestError('The WAV file has no sound in it.', 400);
      await handle.write(wavHeader(sound, RECORDING_SAMPLE_RATE), 0, WAV_HEADER_BYTES, 0);
      await handle.sync();
      await handle.close();
      await this.store.inQueue(companyId, () => renameWithRetry(temp, join(dir, id)));
      return { id, sizeBytes: WAV_HEADER_BYTES + sound, durationMs: durationOfBytes(sound) };
    } catch (error) {
      await handle.close().catch(() => undefined);
      await rm(temp, { force: true }).catch(() => undefined);
      this.store.forgetUpload(companyId, id);
      if (error instanceof WavError) throw new RequestError(error.message, 400);
      throw error;
    }
  }
}

/** Why the saved workspace doesn't take a piece for this recording, or null if it does. */
export function recordingProblem(ws: CompanyWorkspace, fileId: string, sessionId: string): string | null {
  const file = Object.hasOwn(ws.files, fileId) ? ws.files[fileId] : undefined;
  if (!isRecording(file) || file.owner.kind !== 'session') return 'There is no such recording.';
  if (file.owner.sessionId !== sessionId) return 'The recording belongs to another session.';
  if (file.audio.state !== 'recording') return 'The recording has stopped.';
  const record = consentFor(ws, sessionId);
  const state = record && consentState(record);
  if (!state || state.withdrawn || !state.given.audioRecording) return 'Consent no longer allows recording this session.';
  return null;
}

/** Writes a recording's header with the sound it holds (whole samples only), and returns the sound's bytes. */
async function writeSizes(path: string): Promise<number> {
  const handle = await open(path, 'r+');
  try {
    const size = (await handle.stat()).size;
    const sound = Math.max(0, size - WAV_HEADER_BYTES) & ~1;
    if (WAV_HEADER_BYTES + sound !== size) await handle.truncate(WAV_HEADER_BYTES + sound);
    await handle.write(wavHeader(sound, RECORDING_SAMPLE_RATE), 0, WAV_HEADER_BYTES, 0);
    await handle.sync();
    return sound;
  } finally {
    await handle.close();
  }
}

/** For tests: the header a recording's file holds now. */
export async function readHeader(path: string) {
  return readWavHeader(new Uint8Array((await readFile(path)).subarray(0, WAV_HEADER_BYTES)));
}
