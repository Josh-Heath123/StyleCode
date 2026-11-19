import { expect, type Page } from '@playwright/test';
import { kickoff } from './karoo';

/**
 * Karoo Freight's kick-off with a recording of the whole meeting, added as a WAV through the server: shared by the
 * transcription tests and the demo screenshots. The engine is the fake one in tests and demos alike, replaying WP3's
 * recorded output for the role-played kick-off (server/transcription/fake).
 */

const HEADERS = { 'x-stylecode-workspace': '1' };

interface Stored {
  sessions: Record<string, { audioFileIds: string[] }>;
  files: Record<string, unknown>;
  consents: Record<string, { lockedAt: string | null }>;
}

export const card = (page: Page) =>
  page.locator('section').filter({ has: page.getByRole('heading', { name: 'Transcript', exact: true }) });

/** A 16 kHz mono WAV of `seconds` of a quiet tone: the fake engine answers with as much of the meeting as it lasts. */
export function tone(seconds: number): Buffer {
  const rate = 16_000;
  const frames = rate * seconds;
  const bytes = Buffer.alloc(44 + frames * 2);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(36 + frames * 2, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24);
  bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) bytes.writeInt16LE(Math.round(2000 * Math.sin((2 * Math.PI * 220 * i) / rate)), 44 + i * 2);
  return bytes;
}

/**
 * A session with one recording of the whole kick-off (3 min 30 s), added as a
 * WAV through the server, as "Add a WAV file…" does. Retention as given.
 */
export async function withRecording(
  page: Page,
  retention: { kind: 'days'; days: number } | { kind: 'delete-after-transcription' } = { kind: 'days', days: 30 },
  offered = true,
  note?: string,
  name?: string,
) {
  const id = await kickoff(page, { recording: retention, note, name });
  const added = await page.request.post(`/api/workspace/companies/${id}/added-recordings?session=se_1`, {
    headers: { ...HEADERS, 'content-type': 'application/octet-stream' },
    data: tone(210),
  });
  expect(added.status()).toBe(201);
  const stored = (await added.json()) as { id: string; sizeBytes: number; durationMs: number };
  const opened = (await (await page.request.get(`/api/workspace/companies/${id}`, { headers: HEADERS })).json()) as {
    workspace: Stored;
    revision: string;
  };
  const ws = opened.workspace;
  const at = new Date().toISOString();
  ws.files[stored.id] = {
    id: stored.id,
    owner: { kind: 'session', sessionId: 'se_1' },
    purpose: 'audio',
    name: 'kickoff.wav',
    mediaType: 'audio/wav',
    sizeBytes: stored.sizeBytes,
    addedBy: 'Sam Consultant',
    addedAt: at,
    audio: {
      source: 'added',
      recordedAt: at,
      state: 'finished',
      durationMs: stored.durationMs,
      sampleRate: 16_000,
      settings: null,
      recovered: false,
      transcribedAt: null,
    },
  } as never;
  ws.sessions.se_1.audioFileIds = [stored.id];
  ws.consents.cr_1.lockedAt = at;
  const saved = await page.request.put(`/api/workspace/companies/${id}`, {
    headers: HEADERS,
    data: { workspace: ws, baseRevision: opened.revision, permanent: false },
  });
  expect(saved.status()).toBe(200);
  await page.reload();
  if (offered) await expect(card(page).getByRole('button', { name: 'Transcribe…' })).toBeVisible();
  return { id, fileId: stored.id };
}
