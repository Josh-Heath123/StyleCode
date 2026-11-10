import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { kickoff } from './karoo';
import { E2E_WORKSPACE } from './workspaceFolder';

/**
 * Consent after a transcript is imported (Phase 2 brief, WP4): amending the
 * locked record (decision 10), withdrawing and then deleting the transcript
 * and reviewing what keeps a statement (decision 11), and the record's
 * attachment (decision 12). Karoo Freight is role-played.
 */
const SAMPLES = join(import.meta.dirname, '..', 'docs', 'phase-2', 'samples', 'karoo-freight-kickoff');

interface Stored {
  consents: Record<
    string,
    {
      lockedAt: string | null;
      confirmed: unknown;
      attachmentFileId: string | null;
      given: Record<string, unknown>;
      amendments: Record<string, unknown>[];
    }
  >;
  files: Record<string, { name: string; purpose: string }>;
  findings: Record<string, { statement: string }>;
  transcripts: Record<string, unknown>;
  segments: Record<string, unknown>;
}
const onDisk = (id: string) => JSON.parse(readFileSync(join(E2E_WORKSPACE, 'companies', id, 'workspace.json'), 'utf8')) as Stored;

/** Imports the Teams transcript, which locks the consent record (C4). */
async function importTeams(page: Page) {
  await page.getByRole('button', { name: 'Import transcript…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import a transcript' });
  await dialog.getByLabel('File (.vtt, .docx or .txt)').setInputFiles(join(SAMPLES, 'teams-transcript.vtt'));
  await dialog.getByRole('button', { name: 'Import transcript' }).click();
  await expect(dialog).toHaveCount(0);
}

/** Two findings: one rests only on the transcript, one also on the note. */
async function twoFindings(page: Page, id: string) {
  await page.goto(`/#/c/${id}/e/en_1/record`);
  const addFinding = async (statement: string, withNote: boolean) => {
    await page
      .getByRole('button', { name: /Add finding/ })
      .first()
      .click();
    const add = page.getByRole('dialog', { name: 'Add a finding' });
    await add.getByLabel('Statement').fill(statement);
    await add.getByLabel('Kind').selectOption({ label: 'Constraint' });
    if (withNote) await add.getByLabel(/Signal drops between Colesberg/).check();
    await add.getByRole('searchbox', { name: 'Find words in the transcripts' }).fill('Colesberg');
    await add.getByRole('checkbox', { name: /Pieter van Wyk: Accept the job/ }).check();
    await add.getByRole('button', { name: 'Add finding' }).click();
    await expect(add).toHaveCount(0);
  };
  await addFinding('Drivers lose signal on the N1.', true);
  await addFinding('Dispatch must work offline near Colesberg.', false);
}

test('deleting a transcript with consent still given is followed by the same review (decision 11)', async ({ page }) => {
  const id = await kickoff(page, { note: 'Signal drops between Colesberg and Beaufort West.' });
  await importTeams(page);
  await twoFindings(page, id);
  await page.goto(`/#/c/${id}/e/en_1/s/se_1`);
  // A finding in the record quotes it, so it can't be replaced, and says why.
  await expect(page.getByText(/Replacing it isn’t available: 2 findings in the record quote this transcript/)).toBeVisible();
  await page.getByRole('button', { name: 'Delete transcript…' }).click();
  await page.getByRole('dialog', { name: 'Delete transcript…' }).getByRole('button', { name: 'Delete transcript' }).click();
  const dialog = page.getByRole('dialog', { name: 'What keeps a statement from this session' });
  await expect(dialog.getByRole('list', { name: 'Findings' })).toContainText('Drivers lose signal on the N1.');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect.poll(() => Object.values(onDisk(id).findings).map((f) => f.statement)).toEqual(['Drivers lose signal on the N1.']);
});

test('a locked record is amended: what changed, what was newly told and why, checked like the form (C2)', async ({ page }) => {
  const id = await kickoff(page);
  await importTeams(page);
  await page.getByRole('link', { name: 'View consent record' }).click();
  await page.getByRole('button', { name: 'Amend…' }).click();
  const form = page.getByRole('form', { name: 'Amend the consent record' });

  // Statements told before can't be ticked again; agreeing to audio needs its own statements.
  await expect(form.getByRole('checkbox', { name: /turned into a written transcript/ })).toBeDisabled();
  await form.getByRole('group', { name: 'Audio recording' }).getByLabel('Yes').check();
  await expect(form.getByRole('group', { name: 'Audio recording' })).toContainText(
    'Tick what you told them: recording the audio, how long the recording is kept.',
  );
  await form.getByLabel('Reason').fill('Thandi agreed by email to recording the next sessions.');
  await form.getByRole('button', { name: 'Record the change' }).click();
  await expect(form.getByRole('alert')).toContainText('Tick what you told them');
  await form.getByRole('checkbox', { name: /record the audio of this meeting/ }).check();
  await form.getByRole('checkbox', { name: /recording is kept/ }).check();
  await form.getByRole('button', { name: 'Record the change' }).click();

  await expect(form).toHaveCount(0);
  const changes = page.getByRole('list', { name: 'Changes since' });
  await expect(changes).toContainText(/Amended by Sam Consultant, .*Reason: Thandi agreed by email/);
  await expect(changes).toContainText('Audio recording: yes');
  await expect(changes).toContainText('Newly told (wording draft-1):');
  await expect(page.getByText(/^Audio recording \(audio kept until the engagement ends\), transcription/)).toBeVisible();
  // The original stays as it was.
  await expect(page.getByRole('heading', { name: 'The record' }).locator('..')).toContainText('Audio recording: no');
  await expect
    .poll(() => onDisk(id).consents.cr_1.amendments)
    .toMatchObject([
      {
        kind: 'change',
        given: { audioRecording: true },
        told: { recorded: true, retention: true },
        wordingVersion: 'draft-1',
        reason: 'Thandi agreed by email to recording the next sessions.',
      },
    ]);
  expect(onDisk(id).consents.cr_1.given.audioRecording).toBe(false);
  // An amendment is final, like the record it adds to.
  await expect(page.getByRole('button', { name: 'Nothing to undo' })).toBeDisabled();

  // A new retention has to be told in its new words.
  await page.getByRole('button', { name: 'Amend…' }).click();
  await form.getByRole('radio', { name: 'For a number of days' }).check();
  await expect(form).toContainText('The audio is now kept for a different time');
  const retention = form.getByRole('checkbox', { name: /recording is kept/ });
  await expect(retention).toBeEnabled();
  await expect(form).toContainText('Told before in other words.');
  await retention.check();
  await form.getByLabel('Reason').fill('They asked for thirty days.');
  await form.getByRole('button', { name: 'Record the change' }).click();
  await expect(page.getByText(/^Audio recording \(audio kept for 30 days\)/)).toBeVisible();
  await expect.poll(() => onDisk(id).consents.cr_1.amendments.length).toBe(2);

  await page.getByRole('link', { name: 'Back to the session' }).click();
  await expect(page.getByRole('heading', { name: /Consent: given · audio recording, transcription/ })).toBeVisible();
});

test('a consent attachment is added, replaced and removed on a locked record, which stays confirmed (C3)', async ({ page }) => {
  const id = await kickoff(page);
  await importTeams(page);
  await page.getByRole('link', { name: 'View consent record' }).click();
  const card = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Attachment' }) });
  await expect(card).toContainText('No attachment.');
  await card.getByLabel('Attachment file').setInputFiles({
    name: 'thandi-consent-email.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Yes, you may record and transcribe our meetings. Thandi'),
  });
  await expect(card).toContainText('thandi-consent-email.txt');
  await expect(card).toContainText(/added by Sam Consultant/);
  await expect.poll(() => onDisk(id).consents.cr_1.attachmentFileId).not.toBeNull();
  const first = onDisk(id).consents.cr_1.attachmentFileId!;
  expect(onDisk(id).files[first]).toMatchObject({ purpose: 'consent-attachment', name: 'thandi-consent-email.txt' });
  expect(onDisk(id).consents.cr_1.confirmed).not.toBeNull();

  await card.getByLabel('Attachment file').setInputFiles({
    name: 'signed-form.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 role-played'),
  });
  await expect(card).toContainText('signed-form.pdf');
  await expect.poll(() => Object.values(onDisk(id).files).map((f) => f.name)).toEqual(['signed-form.pdf']);

  await card.getByRole('button', { name: 'Remove signed-form.pdf' }).click();
  const dialog = page.getByRole('dialog', { name: 'Remove the attachment…' });
  await expect(dialog).toContainText('This can’t be undone');
  await dialog.getByRole('button', { name: 'Remove the attachment' }).click();
  await expect(card).toContainText('No attachment.');
  await expect.poll(() => onDisk(id).consents.cr_1.attachmentFileId).toBeNull();
  expect(Object.keys(onDisk(id).files)).toEqual([]);
  expect(onDisk(id).consents.cr_1.confirmed).not.toBeNull();
});

test('after a withdrawal: delete the transcript, then review and remove what keeps a statement (C8)', async ({ page }) => {
  const id = await kickoff(page, { note: 'Signal drops between Colesberg and Beaufort West.' });
  await importTeams(page);

  await twoFindings(page, id);
  await page.goto(`/#/c/${id}/e/en_1/s/se_1`);

  await page.getByRole('button', { name: 'Withdraw consent…' }).click();
  let dialog = page.getByRole('dialog', { name: 'Withdraw consent' });
  await dialog.getByLabel('Reason').fill('Thandi asked us to delete the recording of the meeting.');
  await dialog.getByRole('button', { name: 'Record the withdrawal' }).click();

  // First, the offer to delete the transcript, saying what goes.
  dialog = page.getByRole('dialog', { name: 'Delete transcript…' });
  await expect(dialog).toContainText('Consent is withdrawn. If the client asks, delete the transcript too.');
  await expect(dialog).toContainText('Findings that rest only on it are removed:');
  await expect(dialog).toContainText('Dispatch must work offline near Colesberg.');
  await expect(dialog).toContainText('1 finding and 0 company facts keep a statement from this session');
  await dialog.getByRole('button', { name: 'Delete transcript' }).click();

  // Then what keeps a statement, each with a way to edit or remove it.
  dialog = page.getByRole('dialog', { name: 'What keeps a statement from this session' });
  await expect(dialog.getByRole('list', { name: 'Findings' })).toContainText('Drivers lose signal on the N1.');
  await expect(dialog.getByRole('link', { name: 'Edit in the record' })).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
  await dialog.getByRole('button', { name: 'Remove the finding “Drivers lose signal on the N1.”' }).click();
  await expect(dialog).toContainText('Nothing keeps a statement from it now.');
  await dialog.getByRole('button', { name: 'Done' }).click();

  await expect.poll(() => Object.keys(onDisk(id).findings)).toEqual([]);
  const ws = onDisk(id);
  expect(Object.keys(ws.transcripts)).toEqual([]);
  expect(Object.keys(ws.segments)).toEqual([]);
  expect(JSON.stringify(ws)).not.toContain('Accept the job');
  expect(ws.consents.cr_1.amendments).toMatchObject([{ kind: 'withdrawal' }]);
  // Removing a finding is an ordinary step: it can be undone.
  await page.keyboard.press('Control+z');
  await expect.poll(() => Object.values(onDisk(id).findings).map((f) => f.statement)).toEqual(['Drivers lose signal on the N1.']);
  await expect(page.getByRole('button', { name: 'Review what keeps a statement…' })).toBeVisible();
});

test('after a withdrawal the transcript can be kept, and the review is still offered', async ({ page }) => {
  const id = await kickoff(page, { note: 'Signal drops between Colesberg and Beaufort West.' });
  await importTeams(page);
  await page.getByRole('button', { name: 'Withdraw consent…' }).click();
  const withdraw = page.getByRole('dialog', { name: 'Withdraw consent' });
  await withdraw.getByLabel('Reason').fill('They want to stop for now.');
  await withdraw.getByRole('button', { name: 'Record the withdrawal' }).click();
  await page.getByRole('dialog', { name: 'Delete transcript…' }).getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // What was imported before the withdrawal stays until it is deleted.
  await expect(page.getByRole('region', { name: 'What was said' })).toContainText('About a hundred and twenty a day.');
  await expect.poll(() => Object.keys(onDisk(id).transcripts).length).toBe(1);
  await expect(page.getByRole('button', { name: 'Delete transcript…' })).toBeVisible();
  // Replacing it would import again, which consent no longer allows (C7): it says why instead.
  await expect(page.getByRole('button', { name: 'Replace…' })).toHaveCount(0);
  await expect(page.getByText('Replacing it isn’t available: the client withdrew consent for this session.')).toBeVisible();
  // Nothing from the session is in the record yet, so there is nothing to review.
  await expect(page.getByRole('button', { name: 'Review what keeps a statement…' })).toHaveCount(0);
});

test('the Amend… form and the record with an attachment pass the accessibility check', async ({ page }) => {
  await kickoff(page);
  await importTeams(page);
  await page.getByRole('link', { name: 'View consent record' }).click();
  await expect(page.getByRole('heading', { name: 'Attachment' })).toBeVisible();
  let results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
  await page.getByRole('button', { name: 'Amend…' }).click();
  await page.getByRole('group', { name: 'Audio recording' }).getByLabel('Yes').check();
  results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
});
