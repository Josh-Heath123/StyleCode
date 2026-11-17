import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { kickoff } from './karoo';
import { E2E_WORKSPACE } from './workspaceFolder';

/**
 * Retention (Phase 3 brief, WP9; decisions 22 to 25): each recording says
 * how long it is kept; the clients list shows every client's recordings past
 * their time, and those waiting for a transcript, with one action that
 * deletes the first; a withdrawal first offers to delete the recordings, and
 * so does an amendment that turns recording off; each deletion leaves its
 * line. These run after every other test (`playwright.config.ts`), because
 * the list and its action cover every client in the test folder.
 */

const HEADERS = { 'x-stylecode-workspace': '1' };
const SAMPLES = join(import.meta.dirname, '..', 'docs', 'phase-2', 'samples', 'karoo-freight-kickoff');
const DAY = 86_400_000;

interface Stored {
  sessions: Record<string, { audioFileIds: string[]; deletedRecordings: { reason: string; deletedBy: string }[] }>;
  files: Record<string, unknown>;
}
const onDisk = (id: string) => JSON.parse(readFileSync(join(E2E_WORKSPACE, 'companies', id, 'workspace.json'), 'utf8')) as Stored;
const soundFile = (id: string, fileId: string) => join(E2E_WORKSPACE, 'companies', id, 'files', fileId);

/** A 16 kHz mono WAV of `seconds` of silence. */
function wav(seconds: number): Buffer {
  const frames = 16_000 * seconds;
  const bytes = Buffer.alloc(44 + frames * 2);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(36 + frames * 2, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16_000, 24);
  bytes.writeUInt32LE(32_000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(frames * 2, 40);
  return bytes;
}

/** Adds recordings to Kick-off through the server, made `daysAgo` days ago each, and locks the consent record. */
async function withRecordings(page: Page, id: string, recordings: { name: string; daysAgo: number }[]) {
  const ids: string[] = [];
  for (const r of recordings) {
    const added = await page.request.post(`/api/workspace/companies/${id}/added-recordings?session=se_1`, {
      headers: { ...HEADERS, 'content-type': 'application/octet-stream' },
      data: wav(5),
    });
    expect(added.status()).toBe(201);
    const stored = (await added.json()) as { id: string; sizeBytes: number; durationMs: number };
    ids.push(stored.id);
    const opened = (await (await page.request.get(`/api/workspace/companies/${id}`, { headers: HEADERS })).json()) as {
      workspace: Stored & { consents: Record<string, unknown> };
      revision: string;
    };
    const ws = opened.workspace;
    const at = new Date(Date.now() - r.daysAgo * DAY).toISOString();
    ws.files[stored.id] = {
      id: stored.id,
      owner: { kind: 'session', sessionId: 'se_1' },
      purpose: 'audio',
      name: r.name,
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
    };
    ws.sessions.se_1.audioFileIds.push(stored.id);
    // Consent was given before anything was recorded (C1): the record is dated before the oldest recording.
    const consent = ws.consents.cr_1 as {
      lockedAt: string | null;
      confirmed: { at: string } | null;
      createdAt: string;
      updatedAt: string;
    };
    const before = new Date(Date.now() - 100 * DAY).toISOString();
    if (!consent.lockedAt) {
      if (consent.confirmed) consent.confirmed.at = before;
      consent.createdAt = before;
      consent.updatedAt = before;
      consent.lockedAt = before;
    }
    const saved = await page.request.put(`/api/workspace/companies/${id}`, {
      headers: HEADERS,
      data: { workspace: ws, baseRevision: opened.revision, permanent: false },
    });
    expect(saved.status(), await saved.text()).toBe(200);
  }
  await page.reload();
  return ids;
}

const axe = async (page: Page) =>
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations.map((v) => v.id),
  ).toEqual([]);

const recordingsCard = (page: Page) =>
  page.locator('section').filter({ has: page.getByRole('heading', { name: 'Recordings', exact: true }) });

test('each recording says how long it is kept, and one past its time says so', async ({ page }) => {
  const id = await kickoff(page, { recording: { kind: 'days', days: 30 } });
  await withRecordings(page, id, [
    { name: 'Old visit.wav', daysAgo: 40 },
    { name: 'This week.wav', daysAgo: 2 },
  ]);
  const list = recordingsCard(page).getByRole('list', { name: 'Recordings' });
  const old = list.getByRole('listitem').filter({ hasText: 'Old visit.wav' });
  await expect(old).toContainText(/Past its time: it was to be kept until .+\./);
  await expect(old).toContainText('Past its time');
  await axe(page);
  await expect(list.getByRole('listitem').filter({ hasText: 'This week.wav' })).toContainText(/Kept until [^.]+ \d{4}\./);
});

test('the clients list shows every client’s recordings past their time, and those waiting for a transcript, until they’re gone; deleting keeps their lines', async ({
  page,
}) => {
  const due = await kickoff(page, { recording: { kind: 'days', days: 7 } });
  const [old] = await withRecordings(page, due, [{ name: 'Site walk.wav', daysAgo: 10 }]);
  const waiting = await kickoff(page, { recording: { kind: 'delete-after-transcription' } });
  await withRecordings(page, waiting, [{ name: 'Intake.wav', daysAgo: 2 }]);

  await page.goto('/#/');
  const card = page.getByRole('region', { name: 'Recordings to deal with' });
  const dueList = card.getByRole('list', { name: /past the time the client agreed/ });
  await expect(dueList.getByRole('listitem').filter({ hasText: 'Site walk.wav' })).toContainText(
    /Past its time: it was to be kept until/,
  );
  const waitingList = card.getByRole('list', { name: /waiting for a transcript/ });
  await expect(waitingList.getByRole('listitem').filter({ hasText: 'Intake.wav' })).toContainText(
    'Waiting for its transcript. The client was told it’s deleted once transcribed, and it was made a day or more ago',
  );
  await expect(waitingList.getByRole('link', { name: /^Open the session Kick-off/ }).first()).toBeVisible();

  // It shows each time StyleCode opens, until they're gone.
  await page.reload();
  await expect(dueList.getByRole('listitem').filter({ hasText: 'Site walk.wav' })).toBeVisible();
  await axe(page);

  await card.getByRole('button', { name: /^Delete (this recording|these \d+ recordings)…$/ }).click();
  const dialog = page.getByRole('dialog', { name: /^Delete the recordings? past (its|their) time…$/ });
  await axe(page);
  await dialog.getByRole('button', { name: /^Delete/ }).click();
  await expect(card.getByRole('status')).toContainText(/deleted\. Each session keeps its line\./);
  await expect(card.getByRole('list', { name: /past the time the client agreed/ })).toHaveCount(0);
  // The one waiting for a transcript isn't deleted by it.
  await expect(waitingList.getByRole('listitem').filter({ hasText: 'Intake.wav' })).toBeVisible();

  expect(onDisk(due).sessions.se_1.deletedRecordings).toMatchObject([{ reason: 'retention', deletedBy: 'Sam Consultant' }]);
  expect(onDisk(due).sessions.se_1.audioFileIds).toEqual([]);
  expect(existsSync(soundFile(due, old))).toBe(false);

  // The session shows the line.
  await page.goto(`/#/c/${due}/e/en_1/s/se_1`);
  await expect(recordingsCard(page).getByRole('list', { name: 'Deleted recordings' })).toContainText('Why: its time was up.');
});

test('after a withdrawal, the flow first offers to delete the recordings, then the transcript (decision 25)', async ({
  page,
}) => {
  const id = await kickoff(page, { recording: { kind: 'days', days: 30 } });
  await withRecordings(page, id, [{ name: 'Kick-off.wav', daysAgo: 0 }]);
  await expect(recordingsCard(page)).toContainText(/Kept until/);
  await page.getByRole('button', { name: 'Import transcript…' }).click();
  const importing = page.getByRole('dialog', { name: 'Import a transcript' });
  await importing.getByLabel('File (.vtt, .docx or .txt)').setInputFiles(join(SAMPLES, 'teams-transcript.vtt'));
  await importing.getByRole('button', { name: 'Import transcript' }).click();
  await expect(importing).toHaveCount(0);

  await page.getByRole('button', { name: 'Withdraw consent…' }).click();
  const withdraw = page.getByRole('dialog', { name: 'Withdraw consent' });
  await withdraw.getByLabel('Reason').fill('Thandi asked us to delete everything.');
  await withdraw.getByRole('button', { name: 'Record the withdrawal' }).click();

  const recordings = page.getByRole('dialog', { name: 'Delete the recording…' });
  await expect(recordings).toContainText('Consent is withdrawn, so recording is no longer agreed for this session.');
  await expect(recordings.getByRole('list', { name: 'Recordings past their time' })).toContainText('Kick-off.wav');
  await recordings.getByRole('button', { name: /^Delete/ }).click();
  await expect(recordings).toHaveCount(0);
  await expect.poll(() => onDisk(id).sessions.se_1.deletedRecordings).toMatchObject([{ reason: 'withdrawal' }]);
  // Then the transcript.
  const transcript = page.getByRole('dialog', { name: 'Delete transcript…' });
  await expect(transcript).toContainText('Consent is withdrawn. If the client asks, delete the transcript too.');
  await transcript.getByRole('button', { name: 'Cancel' }).click();
  await expect(recordingsCard(page).getByRole('list', { name: 'Deleted recordings' })).toContainText(
    'Why: the client withdrew consent.',
  );
});

test('an amendment that turns recording off offers to delete the recordings now past their time', async ({ page }) => {
  const id = await kickoff(page, { recording: { kind: 'days', days: 30 } });
  await withRecordings(page, id, [{ name: 'Kick-off.wav', daysAgo: 1 }]);
  await page.getByRole('link', { name: 'View consent record' }).click();
  await page.getByRole('button', { name: 'Amend…' }).click();
  const form = page.getByRole('form', { name: 'Amend the consent record' });
  await form.getByRole('group', { name: 'Audio recording' }).getByLabel('No').check();
  await form.getByLabel('Reason').fill('Pieter asked us not to keep recordings.');
  await form.getByRole('button', { name: 'Record the change' }).click();

  const offer = page.getByRole('dialog', { name: 'Delete the recording…' });
  await expect(offer).toContainText('After this amendment, a recording is past the time the client agreed.');
  await offer.getByRole('button', { name: /^Delete/ }).click();
  await expect(offer).toHaveCount(0);
  await expect.poll(() => onDisk(id).sessions.se_1.deletedRecordings).toMatchObject([{ reason: 'retention' }]);
});
