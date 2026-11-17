import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { FAKE_MODEL, startFakeOllama, type FakeOllama } from './fakeOllama';
import { kickoff } from './karoo';
import { E2E_WORKSPACE } from './workspaceFolder';

/**
 * Transcribing on this computer (Phase 3 brief, WP7; decisions 10 and 16 to
 * 22, as changed at the WP3 check-ins): Transcribe or why not, the estimate,
 * progress and Cancel, the preview with its speakers and what adding does,
 * adding (and deleting the recordings when the client was told so), the
 * transcript's "may be misheard" words, speakers and C11, and play from here.
 * The engine is the fake one, replaying WP3's recorded output for Karoo
 * Freight's role-played kick-off (server/transcription/fake); the recording
 * is a generated tone.
 */

// One heavy job at a time on the one test server (decision 10): these tests would wait for each other's transcriptions.
test.describe.configure({ mode: 'default' });

const HEADERS = { 'x-stylecode-workspace': '1' };

interface Stored {
  sessions: Record<string, { audioFileIds: string[]; deletedRecordings: { reason: string; deletedBy: string }[] }>;
  files: Record<string, { audio?: { transcribedAt: string | null } }>;
  transcripts: Record<string, { source: { kind: string } }>;
  participants: Record<string, { speakerLabels: string[] }>;
}
const onDisk = (id: string) => JSON.parse(readFileSync(join(E2E_WORKSPACE, 'companies', id, 'workspace.json'), 'utf8')) as Stored;
const soundFile = (id: string, fileId: string) => join(E2E_WORKSPACE, 'companies', id, 'files', fileId);

const card = (page: Page) =>
  page.locator('section').filter({ has: page.getByRole('heading', { name: 'Transcript', exact: true }) });

/** A 16 kHz mono WAV of `seconds` of a quiet tone: the fake engine answers with as much of the meeting as it lasts. */
function tone(seconds: number): Buffer {
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
async function withRecording(
  page: Page,
  retention: { kind: 'days'; days: number } | { kind: 'delete-after-transcription' } = { kind: 'days', days: 30 },
  offered = true,
) {
  const id = await kickoff(page, { recording: retention });
  const added = await page.request.post(`/api/workspace/companies/${id}/added-recordings`, {
    headers: { ...HEADERS, 'content-type': 'application/octet-stream' },
    data: tone(210),
  });
  expect(added.status()).toBe(201);
  const stored = (await added.json()) as { id: string; sizeBytes: number; durationMs: number };
  const opened = (await (await page.request.get(`/api/workspace/companies/${id}`, { headers: HEADERS })).json()) as {
    workspace: Stored & Record<string, unknown> & { consents: Record<string, { lockedAt: string | null }> };
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

/** Transcribe…, with the options chosen, then waits for it to be ready (or added). */
async function transcribe(page: Page, options: { autoAdd?: boolean } = {}) {
  await card(page).getByRole('button', { name: 'Transcribe…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Transcribe the recordings' });
  await expect(dialog).toContainText('on this computer');
  if (options.autoAdd) await dialog.getByLabel('Add the transcript when it’s ready').check();
  await dialog.getByRole('button', { name: 'Transcribe', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

test('Transcribe gives an estimate, shows progress, waits its turn behind the AI, and Cancel keeps nothing', async ({ page }) => {
  await withRecording(page);
  // The AI holds this computer's heavy slot, as a run on a local model does (decision 10).
  const lease = (await (
    await page.request.post('/api/workspace/heavy', { headers: HEADERS, data: { kind: 'extraction' } })
  ).json()) as { id: string; state: string };
  expect(lease.state).toBe('running');
  try {
    await card(page).getByRole('button', { name: 'Transcribe…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Transcribe the recordings' });
    await expect(dialog.getByTestId('transcribe-estimate')).toContainText(/It should take .+ for 3 min 30 s of sound/);
    await expect(dialog.getByTestId('transcribe-estimate')).toContainText(
      'It starts once the AI has finished reading a session on this computer: one heavy job runs at a time.',
    );
    await expect(dialog).toContainText('Nothing is sent anywhere.');
    await dialog.getByRole('button', { name: 'Transcribe', exact: true }).click();

    const panel = card(page).getByRole('group', { name: 'Transcription' });
    await expect(panel).toContainText('Waiting: the AI is reading a session on this computer, and one heavy job runs at a time.');
    await panel.getByRole('button', { name: 'Cancel the transcription' }).click();
    await expect(card(page)).toContainText('The transcription was cancelled. Nothing it made was kept.');
    await card(page).getByRole('button', { name: 'OK' }).click();
    await expect(card(page).getByRole('button', { name: 'Transcribe…' })).toBeVisible();
  } finally {
    await page.request.delete(`/api/workspace/heavy/${lease.id}`, { headers: HEADERS });
  }

  // With the slot free it runs, with a progress bar, to "ready".
  await transcribe(page);
  const panel = card(page).getByRole('group', { name: 'Transcription' });
  await expect(panel.getByRole('progressbar')).toBeVisible();
  await expect(panel).toContainText('Transcribing on this computer');
  await expect(card(page)).toContainText('The transcript is ready', { timeout: 20_000 });
});

test('the preview says the recordings will be deleted; adding keeps the speakers matched there, deletes the recordings in the same step, and leaves the line', async ({
  page,
}) => {
  const { id, fileId } = await withRecording(page, { kind: 'delete-after-transcription' });
  await transcribe(page);
  await card(page).getByRole('button', { name: 'Review and add…' }).click({ timeout: 20_000 });
  const dialog = page.getByRole('dialog', { name: 'Add the transcript' });
  await expect(dialog).toContainText('Transcribed on this computer by whisper.cpp');
  await expect(dialog).toContainText('The recordings are deleted in the same step, as the client was told.');
  await expect(dialog).toContainText('Adding is permanent');

  // Speakers by talk time; the five under 30 seconds grouped under a summary.
  const rows = dialog.locator('.ws-speaker-table tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Speaker 1');
  await expect(rows.nth(0)).toContainText(/1 min 1\d s/);
  await expect(dialog.locator('.ws-short-labels summary')).toHaveText(/^5 short labels, \d+ s in all$/);
  await expect(dialog.getByRole('note')).toContainText(
    'Not matched to anyone asked for consent: Speaker 1, Speaker 2 and 5 short labels',
  );

  // Matching in the preview: the warning follows.
  await dialog.getByLabel('Who “Speaker 1” is').selectOption({ label: 'Sam Naidoo (your side)' });
  await dialog.getByLabel('Who “Speaker 2” is').selectOption({ label: 'Thandi Mokoena (client)' });
  await expect(dialog.getByRole('note')).toContainText('Not matched to anyone asked for consent: 5 short labels');
  // Playing a label's longest part, while the recording is still here.
  await dialog.getByRole('button', { name: 'Play Speaker 1’s longest part' }).click();
  await expect(dialog.getByRole('group', { name: 'Playing the recording' })).toContainText('Playing Speaker 1’s longest part');

  await dialog.getByRole('button', { name: 'Add transcript' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(card(page)).toContainText('Transcribed on this computer by whisper.cpp');
  const ws = onDisk(id);
  expect(Object.values(ws.transcripts)[0].source.kind).toBe('recording');
  expect(ws.participants.pa_sam.speakerLabels).toEqual(['Speaker 1']);
  expect(ws.participants.pa_thandi.speakerLabels).toEqual(['Speaker 2']);
  // Deleted in the same save, as the client was told, with the session's line saying so.
  expect(ws.sessions.se_1.audioFileIds).toEqual([]);
  expect(ws.sessions.se_1.deletedRecordings).toMatchObject([{ reason: 'transcribed', deletedBy: 'Sam Consultant' }]);
  await expect.poll(() => existsSync(soundFile(id, fileId))).toBe(false);
  const recordings = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Recordings', exact: true }) });
  await expect(recordings.getByRole('list', { name: 'Deleted recordings' })).toContainText(
    'Why: after transcription, as the client was told.',
  );
  // Nothing left to play: the transcript has no play buttons.
  await expect(card(page).getByRole('button', { name: /^Play from/ })).toHaveCount(0);
});

test('added when ready: the transcript says how it was made, marks words that may be misheard, and its speakers warning follows the matching', async ({
  page,
}) => {
  const { id, fileId } = await withRecording(page, { kind: 'days', days: 30 });
  await transcribe(page, { autoAdd: true });
  await expect(card(page)).toContainText('Transcribed on this computer by whisper.cpp 1.9.5 (large-v3-turbo-q5_0)', {
    timeout: 20_000,
  });
  await expect(card(page)).toContainText('speakers by sherpa-onnx');
  // Kept, as the client agreed to 30 days, and marked transcribed.
  await expect.poll(() => onDisk(id).files[fileId]?.audio?.transcribedAt).not.toBeNull();

  // "May be misheard": a dotted underline, said on focus and to screen readers.
  const unsure = card(page).locator('.ws-unsure');
  expect(await unsure.count()).toBeGreaterThan(5);
  await expect(unsure.first()).toContainText('(may be misheard)');
  await expect(unsure.first()).toHaveAttribute('data-unsure', 'May be misheard');
  await unsure.first().focus();
  await expect(unsure.first()).toBeFocused();

  // C11 for recordings: every label not matched to someone asked, the short ones summed up, updating as they're matched.
  const warning = card(page).getByRole('note');
  await expect(warning).toContainText('Not matched to anyone asked for consent: Speaker 1, Speaker 2 and 5 short labels');
  await warning.getByRole('button', { name: 'Show the short labels' }).click();
  await expect(card(page).locator('.ws-short-labels')).toHaveAttribute('open', '');
  await expect(card(page).locator('.ws-short-labels summary')).toBeFocused();

  // Matching from the speaker list, and from a turn in the transcript.
  await card(page).getByLabel('Who “Speaker 1” is').first().selectOption({ label: 'Sam Naidoo (your side)' });
  await expect(warning).toContainText('Not matched to anyone asked for consent: Speaker 2 and 5 short labels');
  await card(page)
    .getByRole('button', { name: /^Match “Speaker 2” at/ })
    .first()
    .click();
  const match = page.getByRole('dialog', { name: 'Who is “Speaker 2”?' });
  await match.getByLabel('Participant').selectOption({ label: 'Pieter van Wyk (client)' });
  await match.getByRole('button', { name: 'Match' }).click();
  await expect(warning).toContainText('Not matched to anyone asked for consent: 5 short labels');
  await expect(card(page).locator('.ws-turn-speaker').filter({ hasText: 'Pieter van Wyk' }).first()).toBeVisible();
  // Lerato wasn't asked: a label matched to her stays in the warning.
  await card(page).getByLabel('Who “Speaker 3” is').selectOption({ label: 'Lerato Dlamini (client)' });
  await expect(warning).toContainText('Not matched to anyone asked for consent: 5 short labels');
  await expect.poll(() => onDisk(id).participants.pa_lerato.speakerLabels).toEqual(['Speaker 3']);
});

test('play from here plays the recording from a segment, and Alt+P pauses it from anywhere', async ({ page }) => {
  await withRecording(page, { kind: 'days', days: 30 });
  await transcribe(page, { autoAdd: true });
  const play = card(page)
    .getByRole('button', { name: /^Play from 0:1\d$/ })
    .first();
  await expect(play).toBeVisible({ timeout: 20_000 });
  const from = (await play.getAttribute('aria-label'))!.replace('Play ', '');
  await play.click();
  const player = card(page).getByRole('group', { name: 'Playing the recording' });
  await expect(player).toContainText(`Playing ${from}`);
  await expect(player.getByRole('button', { name: /Pause/ })).toBeVisible();
  const seconds = Number(from.split(':')[1]);
  await expect
    .poll(async () => Number((await player.locator('.ws-player-clock').innerText()).split(':')[1]))
    .toBeGreaterThan(seconds);
  // From anywhere, even typing a note.
  await page.getByRole('button', { name: /New note/ }).click();
  await page.keyboard.press('Alt+p');
  await expect(player.getByRole('button', { name: /^Play/ })).toBeVisible();
  await page.keyboard.press('Alt+p');
  await expect(player.getByRole('button', { name: /Pause/ })).toBeVisible();
  await player.getByRole('button', { name: 'Stop playing' }).click();
  await expect(player).toHaveCount(0);
});

test('without transcription set up, Transcribe isn’t offered: the session says why, and Settings says what to run', async ({
  page,
}) => {
  const reason =
    'Transcription isn’t set up on this computer. In StyleCode’s folder, run npm run transcription:setup, then reload this page.';
  await page.route('**/api/workspace/transcription', async (route) => {
    const real = (await (await route.fetch()).json()) as Record<string, unknown>;
    await route.fulfill({ json: { ...real, ready: false, reason, gpu: null } });
  });
  await withRecording(page, { kind: 'days', days: 30 }, false);
  await expect(card(page).getByTestId('transcribe-unavailable')).toContainText(
    'Transcribing isn’t available: transcription isn’t set up on this computer. In StyleCode’s folder, run npm run transcription:setup',
  );
  await expect(card(page).getByRole('button', { name: /Transcribe/ })).toHaveCount(0);
  // Importing is still there: an online meeting's transcript needs nothing installed.
  await expect(card(page).getByRole('button', { name: 'Import transcript…' })).toBeVisible();

  await card(page).getByRole('link', { name: 'Transcription in Settings' }).click();
  const settings = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Transcription' }) });
  await expect(settings.getByRole('status')).toHaveText(reason);
  await expect(settings).toContainText('npm run transcription:setup');
  await expect(settings).toContainText('No NVIDIA graphics card found');
});

test('Settings shows transcription’s status, what it installed, with versions and licences, and the GPU', async ({ page }) => {
  await page.goto('/#/settings');
  const settings = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Transcription' }) });
  await expect(settings.getByRole('status')).toHaveText(
    'Set up. Recordings are transcribed on this computer, and nothing is sent anywhere.',
  );
  await expect(settings).toContainText('Fake GPU for tests');
  await expect(settings.getByRole('listitem').filter({ hasText: 'whisper.cpp, Windows x64 with CUDA' })).toContainText('MIT');
  await expect(settings.getByRole('listitem').filter({ hasText: 'ERes2Net' })).toContainText('Apache-2.0');
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations.map((v) => v.id),
  ).toEqual([]);
});

test('transcribing passes the accessibility check: the dialog, progress, the preview and the transcript', async ({ page }) => {
  await withRecording(page, { kind: 'delete-after-transcription' });
  const scan = async () =>
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations.map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
    );
  await card(page).getByRole('button', { name: 'Transcribe…' }).click();
  expect(await scan()).toEqual([]);
  await page.getByRole('dialog').getByRole('button', { name: 'Transcribe', exact: true }).click();
  await expect(card(page).getByRole('group', { name: 'Transcription' })).toBeVisible();
  expect(await scan()).toEqual([]);
  await card(page).getByRole('button', { name: 'Review and add…' }).click({ timeout: 20_000 });
  const dialog = page.getByRole('dialog', { name: 'Add the transcript' });
  await expect(dialog.locator('.ws-speaker-table')).toBeVisible();
  await dialog.locator('.ws-short-labels summary').click();
  expect(await scan()).toEqual([]);
  await dialog.getByRole('button', { name: 'Add transcript' }).click();
  await expect(card(page)).toContainText('Transcribed on this computer');
  await card(page).locator('.ws-short-labels summary').click();
  expect(await scan()).toEqual([]);
});

/** Serves AI settings to the page: Ollama at the fake, as the extraction tests do, so the shared AI settings file isn't touched. */
async function aiOnFake(page: Page, url: string) {
  await page.route('**/api/ai/config', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({
          json: {
            provider: 'ollama',
            configPath: '',
            providers: {
              ollama: { baseUrl: url, model: FAKE_MODEL, contextSize: 8192, hasKey: false, keySource: null },
              openai: { baseUrl: 'https://api.openai.com/v1', model: '', hasKey: false, keySource: null },
              anthropic: { baseUrl: 'https://api.anthropic.com', model: '', hasKey: false, keySource: null },
            },
          },
        })
      : route.continue(),
  );
}

test.describe('with the AI on this computer', () => {
  let fake: FakeOllama;
  test.beforeAll(async () => {
    fake = await startFakeOllama();
  });
  test.afterAll(async () => {
    await fake.close();
  });

  test('“Add the transcript when it’s ready” and “Then ask the AI for findings”: nobody needs to be at the keyboard', async ({
    page,
  }) => {
    await aiOnFake(page, fake.url);
    const { id, fileId } = await withRecording(page, { kind: 'delete-after-transcription' });
    const before = fake.requests.length;
    await card(page).getByRole('button', { name: 'Transcribe…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Transcribe the recordings' });
    const then = dialog.getByLabel('Then ask the AI for findings');
    await expect(then).toBeDisabled();
    await dialog.getByLabel('Add the transcript when it’s ready').check();
    // What the preview would have said, said now: the recordings go when it's added.
    await expect(dialog).toContainText('The recordings are deleted in the same step, as the client was told.');
    await then.check();
    await dialog.getByRole('button', { name: 'Transcribe', exact: true }).click();

    // From here, nothing is clicked: transcribed, added (deleting the recording), and the AI asked.
    await expect(page.getByRole('navigation', { name: 'StyleCode' })).toContainText('The AI has finished “Kick-off”', {
      timeout: 30_000,
    });
    expect(fake.requests.length).toBeGreaterThan(before);
    expect(Object.values(onDisk(id).transcripts)[0].source.kind).toBe('recording');
    expect(onDisk(id).sessions.se_1.deletedRecordings).toMatchObject([{ reason: 'transcribed' }]);
    expect(existsSync(soundFile(id, fileId))).toBe(false);
  });

  test('an AI run on this computer waits its turn behind another heavy job, says so, then reads', async ({ page }) => {
    await aiOnFake(page, fake.url);
    await kickoff(page, { note: 'Thandi wants the pilot in Bloemfontein before the end of March.' });
    // Something else holds the slot, as a transcription would.
    const lease = (await (
      await page.request.post('/api/workspace/heavy', { headers: HEADERS, data: { kind: 'extraction' } })
    ).json()) as { id: string };
    try {
      await page.getByRole('button', { name: 'Ask the AI for findings' }).click();
      await expect(page.getByText('The AI is waiting: another AI run is going on this computer')).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'StyleCode' })).toContainText('The AI is waiting to read “Kick-off”');
    } finally {
      await page.request.delete(`/api/workspace/heavy/${lease.id}`, { headers: HEADERS });
    }
    await expect(page.getByRole('navigation', { name: 'StyleCode' })).toContainText('The AI has finished “Kick-off”', {
      timeout: 20_000,
    });
  });
});
