import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { kickoff } from './karoo';
import { E2E_WORKSPACE } from './workspaceFolder';

/**
 * Transcripts on a session (MVP story 4; Phase 2 brief, WP3): importing a
 * file or pasted text, the preview, the transcript by speaker with the C11
 * warning, matching speakers, replacing and deleting, quoting a segment in a
 * finding, and evidence links that land on the passage. Karoo Freight is
 * role-played, as in docs/phase-2/samples/.
 */
const SAMPLES = join(import.meta.dirname, '..', 'docs', 'phase-2', 'samples', 'karoo-freight-kickoff');
const sample = (name: string) => join(SAMPLES, name);

interface Stored {
  transcripts: Record<string, { source: Record<string, unknown>; unaskedSpeakers: string[] }>;
  segments: Record<string, { text: string; speakerLabel: string | null }>;
  participants: Record<string, { speakerLabels: string[] }>;
  consents: Record<string, { lockedAt: string | null }>;
  findings: Record<string, { provenance: { kind: string }; evidence: { kind: string; segmentId?: string }[] }>;
  files: Record<string, unknown>;
}
const onDisk = (id: string) => JSON.parse(readFileSync(join(E2E_WORKSPACE, 'companies', id, 'workspace.json'), 'utf8')) as Stored;

const card = (page: Page) =>
  page.locator('section').filter({ has: page.getByRole('heading', { name: 'Transcript', exact: true }) });
const transcript = (page: Page) => page.getByRole('region', { name: 'What was said' });

async function importFile(page: Page, file: string) {
  await page.getByRole('button', { name: 'Import transcript…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import a transcript' });
  await dialog.getByLabel('File (.vtt, .docx or .txt)').setInputFiles(sample(file));
  return dialog;
}

test('importing is unavailable until consent to transcription is confirmed, and says why (C1)', async ({ page }) => {
  await kickoff(page, { confirmed: false });
  await expect(card(page)).toContainText(
    'Importing a transcript isn’t available: confirm the consent form for this session first.',
  );
  await expect(page.getByRole('button', { name: 'Import transcript…' })).toHaveCount(0);
});

test('importing a Teams transcript: the preview, then the meeting by speaker, with Lerato’s C11 warning kept', async ({
  page,
}) => {
  const id = await kickoff(page);
  const dialog = await importFile(page, 'teams-transcript.vtt');
  const preview = dialog.getByRole('region', { name: 'What will be imported' });
  await expect(preview).toContainText('Microsoft Teams transcript (.vtt)');
  await expect(preview.getByLabel('Platform')).toHaveValue('teams');
  await expect(preview).toContainText('Segments31, from 0:03 to 4:38');
  await expect(preview).toContainText('Thandi Mokoena · Thandi Mokoena');
  await expect(preview).toContainText('Lerato Dlamini (Guest) · not matched');
  await expect(preview).toContainText('Not asked for consent: Lerato Dlamini (Guest)');
  await expect(preview).toContainText('Importing locks the consent record, and can’t be undone.');
  await dialog.getByRole('button', { name: 'Import transcript' }).click();
  await expect(dialog).toHaveCount(0);

  // The name comes from settings, which tests running alongside may change.
  await expect(card(page)).toContainText(/Imported from teams-transcript\.vtt \(Microsoft Teams\) by \S/);
  await expect(card(page).getByRole('note')).toContainText('Not asked for consent: Lerato Dlamini (Guest)');
  await expect(transcript(page)).toContainText('About a hundred and twenty a day.');
  // The consent record is locked now: it can only be viewed.
  await expect(page.getByRole('link', { name: 'View consent record' })).toBeVisible();

  const ws = onDisk(id);
  const [t] = Object.values(ws.transcripts);
  expect(t.source).toEqual({ kind: 'file', fileName: 'teams-transcript.vtt', format: 'vtt', platform: 'teams' });
  expect(t.unaskedSpeakers).toEqual(['Lerato Dlamini (Guest)']);
  expect(ws.consents.cr_1.lockedAt).not.toBeNull();
  expect(Object.keys(ws.files)).toEqual([]); // The file itself isn't kept.
  expect(Object.values(ws.segments).some((s) => s.text.includes('Colesberg'))).toBe(true);
});

test('matching a speaker changes who said what, survives a reload, and undoes', async ({ page }) => {
  const id = await kickoff(page);
  const dialog = await importFile(page, 'teams-transcript.vtt');
  await dialog.getByRole('button', { name: 'Import transcript' }).click();
  await expect(dialog).toHaveCount(0);
  const lerato = page.getByLabel('Who “Lerato Dlamini (Guest)” is');
  await expect(lerato).toHaveValue('');
  await lerato.selectOption({ label: 'Lerato Dlamini (client)' });
  await expect(page.locator('.ws-turn').filter({ hasText: 'stuck in another call' }).first()).toContainText('Lerato Dlamini');
  await expect.poll(() => onDisk(id).participants.pa_lerato.speakerLabels).toEqual(['Lerato Dlamini (Guest)']);
  // The C11 warning is about consent, which matching doesn't change.
  await expect(card(page).getByRole('note')).toContainText('Not asked for consent: Lerato Dlamini (Guest)');
  await page.reload();
  // Everyone is matched now, so the list opens closed.
  await page.getByText('Speakers: 4 of 4 matched to participants').click();
  await expect(page.getByLabel('Who “Lerato Dlamini (Guest)” is')).toHaveValue('pa_lerato');
  await page.getByLabel('Who “Lerato Dlamini (Guest)” is').selectOption('');
  await expect.poll(() => onDisk(id).participants.pa_lerato.speakerLabels).toEqual([]);
  await page.keyboard.press('Control+z');
  await expect(page.getByLabel('Who “Lerato Dlamini (Guest)” is')).toHaveValue('pa_lerato');
});

test('a file that isn’t a transcript is refused with the reason, and nothing changes', async ({ page }) => {
  const id = await kickoff(page);
  await page.getByRole('button', { name: 'Import transcript…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import a transcript' });
  await dialog.getByLabel('File (.vtt, .docx or .txt)').setInputFiles({
    name: 'shopping.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Milk\nBread\nEggs\n'),
  });
  await expect(dialog.getByRole('alert')).toContainText('This text file isn’t a meeting transcript');
  await expect(dialog.getByRole('alert')).toContainText('Nothing was imported.');
  await expect(dialog.getByRole('button', { name: 'Import transcript' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect(Object.keys(onDisk(id).transcripts)).toEqual([]);
  expect(onDisk(id).consents.cr_1.lockedAt).toBeNull();
});

test('every sample layout imports; a Google Meet transcript without times, Zoom’s times of day from the start', async ({
  page,
}) => {
  await kickoff(page);
  for (const [file, label] of [
    ['google-meet-gemini-notes.docx', 'Google Meet "Notes by Gemini" (.docx): the transcript only'],
    ['zoom-saved-transcript.txt', 'Zoom saved transcript (.txt)'],
    ['teams-transcript-older-layout.docx', 'Microsoft Teams transcript, older layout (.docx)'],
  ]) {
    const dialog = await importFile(page, file);
    await expect(dialog.getByRole('region', { name: 'What will be imported' })).toContainText(label);
    if (file.startsWith('zoom'))
      await expect(dialog).toContainText('the first words at 10:00:03, and the session starts at 10:00');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
  }
});

test('pasting a transcript, replacing it with a file, then deleting it', async ({ page }) => {
  const id = await kickoff(page);
  await page.getByRole('button', { name: 'Import transcript…' }).click();
  let dialog = page.getByRole('dialog', { name: 'Import a transcript' });
  await dialog.getByLabel('Pasted text').check();
  await dialog
    .getByLabel('Transcript, one line per turn: “Name: words”')
    .fill('Thandi Mokoena: Dispatch happens on WhatsApp.\nPieter van Wyk: The signal drops near Colesberg.');
  await expect(dialog.getByRole('region', { name: 'What will be imported' })).toContainText('Segments2');
  await dialog.getByRole('button', { name: 'Import transcript' }).click();
  await expect(card(page)).toContainText(/Pasted by \S/);
  await expect.poll(() => Object.values(onDisk(id).transcripts)[0]?.source).toEqual({ kind: 'pasted' });

  await card(page).getByRole('button', { name: 'Replace…' }).click();
  dialog = page.getByRole('dialog', { name: 'Replace the transcript' });
  await dialog.getByLabel('File (.vtt, .docx or .txt)').setInputFiles(sample('zoom-recording-transcript.vtt'));
  await expect(dialog).toContainText('Replacing deletes the current transcript. This can’t be undone.');
  await dialog.getByRole('button', { name: 'Replace transcript' }).click();
  await expect(card(page)).toContainText('Imported from zoom-recording-transcript.vtt (Zoom)');
  await expect
    .poll(() => Object.values(onDisk(id).transcripts).map((t) => t.source.fileName))
    .toEqual(['zoom-recording-transcript.vtt']);

  await card(page).getByRole('button', { name: 'Delete transcript…' }).click();
  dialog = page.getByRole('dialog', { name: 'Delete transcript…' });
  await expect(dialog).toContainText('This can’t be undone.');
  await dialog.getByRole('button', { name: 'Delete transcript' }).click();
  await expect(card(page)).toContainText('No transcript yet.');
  await expect.poll(() => Object.keys(onDisk(id).transcripts)).toEqual([]);
  expect(Object.keys(onDisk(id).segments)).toEqual([]);
});

test('a finding added by hand quotes the transcript, is said in a session, and its link lands on the passage', async ({
  page,
}) => {
  const id = await kickoff(page);
  const dialog = await importFile(page, 'teams-transcript.vtt');
  await dialog.getByRole('button', { name: 'Import transcript' }).click();
  await expect(dialog).toHaveCount(0);

  await page.goto(`/#/c/${id}/e/en_1/record`);
  await page
    .getByRole('button', { name: /Add finding/ })
    .first()
    .click();
  const add = page.getByRole('dialog', { name: 'Add a finding' });
  await add.getByLabel('Statement').fill('Drivers lose signal between Colesberg and Beaufort West.');
  await add.getByLabel('Kind').selectOption({ label: 'Constraint' });
  await add.getByRole('searchbox', { name: 'Find words in the transcripts' }).fill('Colesberg');
  await add.getByRole('checkbox', { name: /Pieter van Wyk: Accept the job/ }).check();
  await add.getByLabel(/The words quoted from/).fill('between Colesberg and Beaufort West');
  await add.getByRole('button', { name: 'Add finding' }).click();
  await expect(add).toHaveCount(0);

  const finding = page.locator('.ws-finding').filter({ hasText: 'Drivers lose signal' });
  await expect(finding).toContainText('Said in a session');
  await expect(finding).toContainText('said by Pieter van Wyk');
  await expect.poll(() => Object.values(onDisk(id).findings)[0]?.provenance.kind).toBe('said-in-session');

  await finding.getByRole('link', { name: 'Kick-off' }).click();
  await expect(page).toHaveURL(/\/s\/se_1\/p\/sg_/);
  const cited = page.locator('.ws-segment.is-cited');
  await expect(cited).toContainText('between Colesberg and Beaufort West');
  await expect(cited).toBeFocused();
  await page.goBack();
  await expect(page).toHaveURL(/\/record$/);
  await page.goForward();
  await expect(page.locator('.ws-segment.is-cited')).toBeFocused();
});

test('the transcript, matching and the import dialog pass the accessibility check', async ({ page }) => {
  await kickoff(page);
  const dialog = await importFile(page, 'teams-transcript.vtt');
  await expect(dialog.getByRole('region', { name: 'What will be imported' })).toBeVisible();
  let results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
  await dialog.getByRole('button', { name: 'Import transcript' }).click();
  await expect(dialog).toHaveCount(0);
  results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
});
