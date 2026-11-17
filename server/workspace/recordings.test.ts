import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readWavHeader, wavHeader } from '../../src/workspace/audio/wav.ts';
import { amendConsent } from '../../src/workspace/model/consent.ts';
import { consentRecord, sampleWorkspace } from '../../src/workspace/model/fixtures.ts';
import type { CompanyWorkspace } from '../../src/workspace/model/index.ts';
import { DEFAULT_RECORDING_SETTINGS, finishRecording, startRecording } from '../../src/workspace/model/recordings.ts';
import { LIVE_MS, MAX_SOUND_BYTES, MIN_FREE_BYTES, RecordingFiles, recordingProblem } from './recordings.ts';
import { WorkspaceStore } from './store.ts';

/** Recordings on disk (Phase 3 brief, decisions 12, 13 and 15, and "Clarifications"). Role-played data, generated tones. */

let root: string;
let store: WorkspaceStore;
let free: number;
let clock: number;
let files: RecordingFiles;
const GB = 1024 ** 3;
const AT = '2026-11-05T08:00:00.000Z';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'stylecode-recordings-'));
  mkdirSync(join(root, 'companies'));
  store = new WorkspaceStore(root, { retry: { attempts: 2, delayMs: 1 } });
  free = 20 * GB;
  clock = Date.now();
  files = new RecordingFiles(store, { freeBytes: async () => free, now: () => clock });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** A client whose session se_2 has a confirmed consent record that agrees to recording. */
async function client(name = 'Bosveld Citrus'): Promise<{ id: string; ws: CompanyWorkspace; revision: string }> {
  const opened = await store.create({ name });
  const id = opened.workspace.company.id;
  const sample = sampleWorkspace();
  const ws: CompanyWorkspace = {
    ...opened.workspace,
    engagements: { en_1: { ...sample.engagements.en_1, companyId: id } },
    sessions: { se_2: { ...sample.sessions.se_1, id: 'se_2' } },
    participants: { pa_thandi: { ...sample.participants.pa_client, id: 'pa_thandi', sessionId: 'se_2' } },
    consents: {
      cr_2: consentRecord({
        id: 'cr_2',
        sessionId: 'se_2',
        askedParticipantIds: ['pa_thandi'],
        given: { audioRecording: true, transcription: true, aiLocal: false, aiExternal: false, externalProvider: null },
        lockedAt: null,
      }),
    },
  };
  const saved = await store.save(id, ws, opened.revision, false);
  return { id, ws, revision: saved.revision };
}

/** Starts a recording on disk and lists it, as the app does. */
async function recording(name?: string) {
  const c = await client(name);
  const started = await files.start(c.id);
  const listed = startRecording(c.ws, 'se_2', { id: started.id, settings: DEFAULT_RECORDING_SETTINGS }, 'Sam', AT);
  if (!listed.ok) throw new Error(listed.error);
  const saved = await store.save(c.id, listed.value.workspace, c.revision, true);
  return {
    ...c,
    ws: listed.value.workspace,
    revision: saved.revision,
    fileId: started.id,
    path: join(root, 'companies', c.id, 'files', started.id),
  };
}

const piece = (bytes: number, value = 1) => Buffer.alloc(bytes, value);

describe('starting', () => {
  it('makes the file with a header, and says how much space is left', async () => {
    const c = await client();
    const started = await files.start(c.id);
    expect(started).toMatchObject({ freeBytes: 20 * GB, lowSpace: false });
    const path = join(root, 'companies', c.id, 'files', started.id);
    expect(readWavHeader(readFileSync(path))).toMatchObject({ encoding: 'int16', channels: 1, sampleRate: 16_000 });
  });

  it('refuses under 1 GB free, and warns under 5 GB', async () => {
    const c = await client();
    free = MIN_FREE_BYTES - 1;
    await expect(files.start(c.id)).rejects.toMatchObject({ status: 507, message: expect.stringMatching(/Under 1 GB is free/) });
    free = 4 * GB;
    expect((await files.start(c.id)).lowSpace).toBe(true);
  });

  it('keeps a started file through a save that doesn’t list it yet', async () => {
    const c = await client();
    const started = await files.start(c.id);
    await store.save(c.id, c.ws, c.revision, true);
    expect(readdirSync(join(root, 'companies', c.id, 'files'))).toContain(started.id);
  });
});

describe('pieces', () => {
  it('writes each at its offset, and a piece sent twice only once', async () => {
    const r = await recording();
    expect(await files.append(r.id, r.fileId, 'se_2', 0, piece(3200, 1))).toEqual({ bytes: 3200, full: false });
    expect(await files.append(r.id, r.fileId, 'se_2', 0, piece(3200, 9))).toEqual({ bytes: 3200, full: false });
    // Overlapping: only the new part is written.
    expect(await files.append(r.id, r.fileId, 'se_2', 1600, piece(3200, 2))).toEqual({ bytes: 4800, full: false });
    const bytes = readFileSync(r.path);
    expect(bytes.length).toBe(44 + 4800);
    expect(bytes[44 + 3199]).toBe(1);
    expect(bytes[44 + 3200]).toBe(2);
  });

  it('refuses a piece after a gap, saying where the file ends', async () => {
    const r = await recording();
    await files.append(r.id, r.fileId, 'se_2', 0, piece(100));
    await expect(files.append(r.id, r.fileId, 'se_2', 400, piece(100))).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/has 100 bytes/),
    });
  });

  it('takes pieces only for a recording the workspace lists as recording, in that session, with consent', async () => {
    const r = await recording();
    await expect(files.append(r.id, r.fileId, 'se_9', 0, piece(2))).rejects.toMatchObject({ status: 409 });
    await expect(files.append(r.id, 'fi_unknown', 'se_2', 0, piece(2))).rejects.toMatchObject({ status: 409 });
    await files.append(r.id, r.fileId, 'se_2', 0, piece(2));
    // A withdrawal stops the pieces (C8).
    const withdrawn = structuredClone(r.ws);
    const amended = amendConsent(withdrawn.consents.cr_2, {
      id: 'am_1',
      kind: 'withdrawal',
      by: 'Sam',
      at: '2026-11-05T08:10:00.000Z',
      reason: 'Asked to stop.',
    });
    if (!amended.ok) throw new Error(amended.error);
    withdrawn.consents.cr_2 = amended.value;
    await store.save(r.id, withdrawn, r.revision, false);
    await expect(files.append(r.id, r.fileId, 'se_2', 2, piece(2))).rejects.toMatchObject({
      status: 409,
      message: 'Consent no longer allows recording this session.',
    });
    expect(recordingProblem(withdrawn, r.fileId, 'se_2')).toBe('Consent no longer allows recording this session.');
  });

  it('stops at 4 hours, saying the recording is full', async () => {
    const r = await recording();
    const handleSize = MAX_SOUND_BYTES - 100;
    // Pretend nearly 4 hours were written already.
    const { truncateSync } = await import('node:fs');
    truncateSync(r.path, 44 + handleSize);
    expect(await files.append(r.id, r.fileId, 'se_2', handleSize, piece(400))).toEqual({ bytes: MAX_SOUND_BYTES, full: true });
  });

  it('refuses half samples and odd offsets', async () => {
    const r = await recording();
    await expect(files.append(r.id, r.fileId, 'se_2', 0, piece(3))).rejects.toMatchObject({ status: 400 });
    await expect(files.append(r.id, r.fileId, 'se_2', 1, piece(2))).rejects.toMatchObject({ status: 400 });
  });
});

describe('finishing and recovery', () => {
  it('writes the header’s sizes and gives the length', async () => {
    const r = await recording();
    await files.append(r.id, r.fileId, 'se_2', 0, piece(32_000 * 3));
    expect(await files.finish(r.id, r.fileId, false)).toEqual({ sizeBytes: 44 + 96_000, durationMs: 3000 });
    expect(readWavHeader(readFileSync(r.path))?.dataBytes).toBe(96_000);
  });

  it('won’t recover a recording another window wrote to a moment ago, and will once it is quiet', async () => {
    const r = await recording();
    await files.append(r.id, r.fileId, 'se_2', 0, piece(32_000));
    clock = statSync(r.path).mtimeMs + 1000;
    await expect(files.finish(r.id, r.fileId, true)).rejects.toMatchObject({ status: 409 });
    clock += LIVE_MS;
    expect(await files.finish(r.id, r.fileId, true)).toEqual({ sizeBytes: 32_044, durationMs: 1000 });
  });

  it('closes, at start-up, every recording a crash left unfinished, but not one still being written', async () => {
    const r = await recording();
    await files.append(r.id, r.fileId, 'se_2', 0, piece(16_001 * 2));
    const old = new Date(Date.now() - 60_000);
    utimesSync(r.path, old, old);
    clock = Date.now();
    expect(await files.closeUnfinished()).toBe(1);
    expect(readWavHeader(readFileSync(r.path))?.dataBytes).toBe(32_002);
    const fresh = await recording('Umoya School');
    await files.append(fresh.id, fresh.fileId, 'se_2', 0, piece(2));
    // The first was written a moment ago (its header), and the new one is still being written.
    expect(await files.closeUnfinished()).toBe(0);
    expect(readWavHeader(readFileSync(fresh.path))?.dataBytes).toBeNull();
  });

  it('finishes a recording the app then lists as finished, which the workspace accepts', async () => {
    const r = await recording();
    await files.append(r.id, r.fileId, 'se_2', 0, piece(64_000));
    const done = await files.finish(r.id, r.fileId, false);
    const ws = finishRecording(r.ws, r.fileId, { ...done, recovered: false });
    if (!ws.ok) throw new Error(ws.error);
    await expect(store.save(r.id, ws.value, r.revision, true)).resolves.toBeDefined();
  });
});

/** A WAV made elsewhere: 48 kHz stereo 32-bit float, a tone. */
function floatWav(seconds: number, rate = 48_000): Buffer {
  const frames = rate * seconds;
  const bytes = Buffer.alloc(44 + frames * 8);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(36 + frames * 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(3, 20);
  bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(rate, 24);
  bytes.writeUInt32LE(rate * 8, 28);
  bytes.writeUInt16LE(8, 32);
  bytes.writeUInt16LE(32, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(frames * 8, 40);
  for (let i = 0; i < frames; i++) {
    const s = 0.3 * Math.sin((2 * Math.PI * 300 * i) / rate);
    bytes.writeFloatLE(s, 44 + i * 8);
    bytes.writeFloatLE(s, 48 + i * 8);
  }
  return bytes;
}

async function* inPieces(bytes: Buffer, size: number) {
  for (let at = 0; at < bytes.length; at += size) yield bytes.subarray(at, at + size);
}

describe('adding a WAV made elsewhere (decision 15)', () => {
  it('is refused before any sound is stored, unless consent allows recording the session now', async () => {
    const c = await client();
    await expect(files.addWav(c.id, 'se_9', inPieces(floatWav(1), 4096))).rejects.toMatchObject({ status: 409 });
    const off = structuredClone(c.ws);
    off.consents.cr_2.given.audioRecording = false;
    await store.save(c.id, off, c.revision, false);
    await expect(files.addWav(c.id, 'se_2', inPieces(floatWav(1), 4096))).rejects.toMatchObject({
      status: 409,
      message: 'The client did not agree to audio recording.',
    });
    expect(readdirSync(join(root, 'companies', c.id, 'files'))).toEqual([]);
  });

  it('converts it to 16 kHz mono 16-bit as it streams in', async () => {
    const c = await client();
    const added = await files.addWav(c.id, 'se_2', inPieces(floatWav(2), 7777));
    expect(added.durationMs).toBe(2000);
    const stored = readFileSync(join(root, 'companies', c.id, 'files', added.id));
    expect(stored.length).toBe(added.sizeBytes);
    expect(readWavHeader(stored)).toEqual({
      encoding: 'int16',
      channels: 1,
      sampleRate: 16_000,
      dataOffset: 44,
      dataBytes: 64_000,
    });
  });

  it('refuses another format, saying to convert to WAV, and leaves nothing behind', async () => {
    const c = await client();
    await expect(
      files.addWav(c.id, 'se_2', inPieces(Buffer.from('ID3\u0004 an MP3 file, not a WAV at all'), 8)),
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/Convert the recording to WAV first/),
    });
    await expect(files.addWav(c.id, 'se_2', inPieces(Buffer.from(wavHeader(0, 16_000)), 8))).rejects.toMatchObject({
      status: 400,
    });
    expect(readdirSync(join(root, 'companies', c.id, 'files'))).toEqual([]);
  });

  it('refuses one over the size limit, or longer than 4 hours by its header', async () => {
    const c = await client();
    await expect(files.addWav(c.id, 'se_2', inPieces(floatWav(1), 4096), 1000)).rejects.toMatchObject({ status: 413 });
    const long = Buffer.from(wavHeader(0, 16_000));
    long.writeUInt32LE(4 * 3600 * 32_000 + 2, 40);
    await expect(files.addWav(c.id, 'se_2', inPieces(long, 44))).rejects.toMatchObject({
      status: 413,
      message: 'A recording is at most 4 hours long.',
    });
  });
});
