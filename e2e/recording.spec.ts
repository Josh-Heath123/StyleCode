import { existsSync, readFileSync, statSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { kickoff } from './karoo';
import { E2E_WORKSPACE } from './workspaceFolder';

/**
 * Recording a meeting in the room (Phase 3 brief, WP6; decisions 12 to 15):
 * Record or why not, the first-time lock, the recording on every page, Stop
 * by click and by key, several recordings and deleting one, a withdrawal
 * stopping it, recovery after a crash, and adding a WAV. The microphone is
 * Chromium's fake device playing a generated tone (playwright.config.ts).
 * Karoo Freight is role-played.
 */

// Each test records live audio from the fake microphone for a few seconds. One at a time, in one worker,
// so they don't load the computer enough to slow the rest of the suite past its timeouts.
test.describe.configure({ mode: 'default' });

const HEADERS = { 'x-stylecode-workspace': '1' };

interface Stored {
  sessions: Record<string, { audioFileIds: string[]; deletedRecordings: { reason: string; deletedBy: string }[] }>;
  consents: Record<string, { lockedAt: string | null; amendments: unknown[] }>;
  files: Record<
    string,
    {
      name: string;
      sizeBytes: number;
      audio?: { state: string; durationMs: number; recovered: boolean; source: string; settings: unknown };
    }
  >;
}
const onDisk = (id: string) => JSON.parse(readFileSync(join(E2E_WORKSPACE, 'companies', id, 'workspace.json'), 'utf8')) as Stored;
const soundFile = (id: string, fileId: string) => join(E2E_WORKSPACE, 'companies', id, 'files', fileId);

const card = (page: Page) =>
  page.locator('section').filter({ has: page.getByRole('heading', { name: 'Recordings', exact: true }) });
const live = (page: Page) => card(page).getByRole('group', { name: 'Recording' });
const nav = (page: Page) => page.getByRole('navigation', { name: 'StyleCode' });

/** Starts recording from the session page, confirming the lock the first time. */
async function record(page: Page, first = true) {
  await card(page).getByRole('button', { name: 'Record', exact: true }).click();
  if (first) {
    const dialog = page.getByRole('dialog', { name: 'Start recording' });
    await expect(dialog).toContainText('Starting the first recording locks this session’s consent record.');
    await dialog.getByRole('button', { name: 'Start recording' }).click();
    await expect(dialog).toHaveCount(0);
  }
  await expect(live(page)).toContainText('Recording');
}

/** Waits until the recording has at least `seconds` of sound. */
async function recordFor(page: Page, seconds: number) {
  await expect
    .poll(
      async () => {
        const [m, s] = (await live(page).locator('.ws-live-clock').innerText()).split(':').map(Number);
        return m * 60 + s;
      },
      { timeout: 20_000 },
    )
    .toBeGreaterThanOrEqual(seconds);
}

test('Record is unavailable without consent to recording, and says why', async ({ page }) => {
  await kickoff(page);
  await expect(card(page)).toContainText('Recording isn’t available: the client did not agree to audio recording.');
  await expect(card(page).getByRole('button', { name: 'Record', exact: true })).toHaveCount(0);
});

test('the first recording locks the consent record, records the microphone, shows on every page, and stops by click', async ({
  page,
}) => {
  const id = await kickoff(page, { recording: { kind: 'days', days: 30 } });
  expect(onDisk(id).consents.cr_1.lockedAt).toBeNull();
  await record(page);
  expect(onDisk(id).consents.cr_1.lockedAt).not.toBeNull();
  // Stop has focus, one key away.
  await expect(live(page).getByRole('button', { name: /Stop/ })).toBeFocused();
  await recordFor(page, 3);
  await expect.poll(async () => Number(await live(page).getByRole('meter').getAttribute('aria-valuenow'))).toBeGreaterThan(5);

  // On another page, the recording carries on, with its time, level and Stop.
  await page.getByRole('link', { name: 'Dispatch app' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Dispatch app' })).toBeVisible();
  const indicator = nav(page).getByRole('group', { name: 'Recording' });
  await expect(indicator).toContainText('Recording “Kick-off”');
  await expect(indicator.getByRole('meter')).toBeVisible();
  const fileId = onDisk(id).sessions.se_1.audioFileIds[0];
  // The sound reaches the disk as it goes, every few seconds.
  await expect.poll(() => statSync(soundFile(id, fileId)).size, { timeout: 10_000 }).toBeGreaterThan(44 + 32_000 * 2);
  await indicator.getByRole('button', { name: 'Stop' }).click();
  await expect(indicator).toHaveCount(0);

  await expect.poll(() => onDisk(id).files[fileId]?.audio?.state).toBe('finished');
  const stored = onDisk(id).files[fileId];
  expect(stored.audio).toMatchObject({
    source: 'recorded',
    recovered: false,
    settings: { echoCancellation: false, noiseSuppression: false, autoGainControl: true },
  });
  expect(stored.audio!.durationMs).toBeGreaterThanOrEqual(3000);
  // A 16 kHz mono 16-bit WAV: 32,000 bytes a second, after a 44-byte header that now says how long it is.
  const bytes = readFileSync(soundFile(id, fileId));
  expect(bytes.length).toBe(stored.sizeBytes);
  expect(bytes.readUInt32LE(40)).toBe(bytes.length - 44);
  expect(Math.abs((bytes.length - 44) / 32 - stored.audio!.durationMs)).toBeLessThan(2);

  await page.goBack();
  await expect(card(page).getByRole('listitem')).toContainText('Recording 1');
});

test(`Alt+S stops a recording from anywhere, even while typing a note`, async ({ page }) => {
  const id = await kickoff(page, { recording: { kind: 'until-engagement-ends' } });
  await record(page);
  await recordFor(page, 1);
  await page.getByRole('button', { name: /New note/ }).click();
  const note = page.getByRole('textbox', { name: 'New note' });
  await expect(note).toBeFocused();
  await note.pressSequentially('Asked about cold-chain trucks');
  await page.keyboard.press('Alt+s');
  await expect(live(page)).toHaveCount(0);
  await expect(note).toHaveValue('Asked about cold-chain trucks');
  const fileId = onDisk(id).sessions.se_1.audioFileIds[0];
  await expect.poll(() => onDisk(id).files[fileId]?.audio?.state).toBe('finished');
});

test('a session can have several recordings; deleting one is permanent and leaves a line', async ({ page }) => {
  const id = await kickoff(page, { recording: { kind: 'until-engagement-ends' } });
  await record(page);
  await recordFor(page, 1);
  await live(page).getByRole('button', { name: /Stop/ }).click();
  await expect(live(page)).toHaveCount(0);
  // The record is locked now, so the second recording starts straight away.
  await record(page, false);
  await recordFor(page, 1);
  await live(page).getByRole('button', { name: /Stop/ }).click();
  await expect(card(page).getByRole('listitem')).toHaveCount(2);
  const [first, second] = onDisk(id).sessions.se_1.audioFileIds;

  await card(page).getByRole('button', { name: 'Delete Recording 1' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete recording…' });
  await expect(dialog).toContainText('The session keeps a line saying when it was recorded');
  await dialog.getByRole('button', { name: 'Delete recording' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(card(page).getByRole('listitem')).toHaveCount(1);
  await expect(card(page).getByRole('listitem')).toContainText('Recording 2');
  await expect.poll(() => onDisk(id).sessions.se_1.audioFileIds).toEqual([second]);
  expect(onDisk(id).sessions.se_1.deletedRecordings).toMatchObject([{ reason: 'consultant', deletedBy: 'Sam Consultant' }]);
  await expect.poll(() => existsSync(soundFile(id, first))).toBe(false);
});

test('a withdrawal of consent stops the recording first, keeping what it recorded', async ({ page }) => {
  const id = await kickoff(page, { recording: { kind: 'days', days: 7 } });
  await record(page);
  await recordFor(page, 2);
  await page.getByRole('button', { name: 'Withdraw consent…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Withdraw consent' });
  await dialog.getByLabel('Reason').fill('Asked us to stop recording.');
  await dialog.getByRole('button', { name: 'Record the withdrawal' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(live(page)).toHaveCount(0);
  const fileId = onDisk(id).sessions.se_1.audioFileIds[0];
  expect(onDisk(id).files[fileId].audio).toMatchObject({ state: 'finished' });
  expect(onDisk(id).files[fileId].audio!.durationMs).toBeGreaterThanOrEqual(2000);
  await expect(card(page)).toContainText('Recording isn’t available: the client withdrew consent for this session.');
});

test('a recording a crash left unfinished is finished with what arrived, and says it was recovered', async ({ page }) => {
  const id = await kickoff(page, { recording: { kind: 'until-engagement-ends' } });
  // A recording started, a few seconds sent, then the browser went away.
  const started = (await (await page.request.post(`/api/workspace/companies/${id}/recordings`, { headers: HEADERS })).json()) as {
    id: string;
  };
  const opened = (await (await page.request.get(`/api/workspace/companies/${id}`, { headers: HEADERS })).json()) as {
    workspace: Stored & Record<string, unknown>;
    revision: string;
  };
  const ws = opened.workspace;
  const at = new Date().toISOString();
  ws.files[started.id] = {
    id: started.id,
    owner: { kind: 'session', sessionId: 'se_1' },
    purpose: 'audio',
    name: 'Recording 1',
    mediaType: 'audio/wav',
    sizeBytes: 0,
    addedBy: 'Sam Consultant',
    addedAt: at,
    audio: {
      source: 'recorded',
      recordedAt: at,
      state: 'recording',
      durationMs: 0,
      sampleRate: 16_000,
      settings: { echoCancellation: false, noiseSuppression: false, autoGainControl: true },
      recovered: false,
      transcribedAt: null,
    },
  } as never;
  ws.sessions.se_1.audioFileIds = [started.id];
  (ws.consents.cr_1 as { lockedAt: string | null }).lockedAt = at;
  const saved = await page.request.put(`/api/workspace/companies/${id}`, {
    headers: HEADERS,
    data: { workspace: ws, baseRevision: opened.revision, permanent: false },
  });
  expect(saved.status()).toBe(200);
  const piece = await page.request.put(`/api/workspace/companies/${id}/recordings/${started.id}?session=se_1&offset=0`, {
    headers: { ...HEADERS, 'content-type': 'application/octet-stream' },
    data: Buffer.alloc(32_000 * 3, 1),
  });
  expect(piece.status()).toBe(200);
  // Nothing has written to it for a while.
  const old = new Date(Date.now() - 60_000);
  utimesSync(soundFile(id, started.id), old, old);

  await page.reload();
  await expect(card(page).getByRole('listitem')).toContainText('Recovered: StyleCode stopped while recording');
  await expect
    .poll(() => onDisk(id).files[started.id]?.audio)
    .toMatchObject({ state: 'finished', recovered: true, durationMs: 3000 });
  expect(readFileSync(soundFile(id, started.id)).readUInt32LE(40)).toBe(96_000);
});

/** A WAV made elsewhere: 44.1 kHz stereo 16-bit, two seconds of a tone. */
function wavFile(): Buffer {
  const rate = 44_100;
  const frames = rate * 2;
  const bytes = Buffer.alloc(44 + frames * 4);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(36 + frames * 4, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(rate, 24);
  bytes.writeUInt32LE(rate * 4, 28);
  bytes.writeUInt16LE(4, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i++) {
    const s = Math.round(8000 * Math.sin((2 * Math.PI * 330 * i) / rate));
    bytes.writeInt16LE(s, 44 + i * 4);
    bytes.writeInt16LE(s, 46 + i * 4);
  }
  return bytes;
}

test('a WAV made elsewhere is added as a recording, converted to 16 kHz mono; another format is refused', async ({ page }) => {
  const id = await kickoff(page, { recording: { kind: 'until-engagement-ends' } });
  const chooser = page.waitForEvent('filechooser');
  await card(page).getByRole('button', { name: 'Add a WAV file…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a recording' });
  await expect(dialog).toContainText('Adding the first recording locks this session’s consent record.');
  await dialog.getByRole('button', { name: 'Choose a WAV file…' }).click();
  await (await chooser).setFiles({ name: 'kickoff-phone.wav', mimeType: 'audio/wav', buffer: wavFile() });
  await expect(card(page).getByRole('listitem')).toContainText('kickoff-phone.wav');
  await expect(card(page).getByRole('listitem')).toContainText('WAV file');
  await expect.poll(() => onDisk(id).sessions.se_1.audioFileIds.length).toBe(1);
  const fileId = onDisk(id).sessions.se_1.audioFileIds[0];
  expect(onDisk(id).files[fileId].audio).toMatchObject({ source: 'added', durationMs: 2000, settings: null });
  expect(onDisk(id).consents.cr_1.lockedAt).not.toBeNull();
  expect(readFileSync(soundFile(id, fileId)).readUInt32LE(24)).toBe(16_000);

  const another = page.waitForEvent('filechooser');
  await card(page).getByRole('button', { name: 'Add a WAV file…' }).click();
  await (await another).setFiles({ name: 'kickoff.m4a', mimeType: 'audio/mp4', buffer: Buffer.from('not a wav') });
  await expect(card(page).getByRole('alert')).toContainText('StyleCode adds WAV files only. Convert the recording to WAV first');
});

test('recording passes the accessibility check: the card, the lock dialog, and a recording going', async ({ page }) => {
  await kickoff(page, { recording: { kind: 'until-engagement-ends' } });
  const scan = async () =>
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations.map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
    );
  expect(await scan()).toEqual([]);
  await card(page).getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Start recording' })).toBeVisible();
  expect(await scan()).toEqual([]);
  await page.getByRole('dialog', { name: 'Start recording' }).getByRole('button', { name: 'Start recording' }).click();
  await expect(live(page)).toContainText('Recording');
  expect(await scan()).toEqual([]);
  await page.keyboard.press('Alt+s');
  await expect(live(page)).toHaveCount(0);
});
