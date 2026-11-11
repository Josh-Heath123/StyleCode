import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { kickoff } from './karoo';
import { E2E_WORKSPACE } from './workspaceFolder';

/**
 * Company knowledge (Phase 2 brief, WP8; decisions 11, 15 and 17): a finding
 * promoted from the record shows on the client's page and in every engagement
 * with that client, and no other, with its source or "source deleted".
 * Karoo Freight is role-played.
 */
const SAMPLES = join(import.meta.dirname, '..', 'docs', 'phase-2', 'samples', 'karoo-freight-kickoff');

interface Stored {
  knowledge: Record<string, { statement: string; status: string; source: { findingId: string | null; quotes: unknown[] } }>;
  findings: Record<string, { statement: string }>;
}
const onDisk = (id: string) => JSON.parse(readFileSync(join(E2E_WORKSPACE, 'companies', id, 'workspace.json'), 'utf8')) as Stored;

const OFFLINE = 'Dispatch must work offline near Colesberg.';

/** Imports the Teams transcript, then adds a confirmed finding to the record that quotes Pieter. */
async function withFinding(page: Page): Promise<string> {
  const id = await kickoff(page);
  await page.getByRole('button', { name: 'Import transcript…' }).click();
  const imp = page.getByRole('dialog', { name: 'Import a transcript' });
  await imp.getByLabel('File (.vtt, .docx or .txt)').setInputFiles(join(SAMPLES, 'teams-transcript.vtt'));
  await imp.getByRole('button', { name: 'Import transcript' }).click();
  await expect(imp).toHaveCount(0);
  await page.goto(`/#/c/${id}/e/en_1/record`);
  await page
    .getByRole('button', { name: /Add finding/ })
    .first()
    .click();
  const add = page.getByRole('dialog', { name: 'Add a finding' });
  await add.getByLabel('Statement').fill(OFFLINE);
  await add.getByLabel('Kind').selectOption({ label: 'Constraint' });
  await add.getByLabel('Confirmed').check();
  await add.getByRole('searchbox', { name: 'Find words in the transcripts' }).fill('Colesberg');
  await add.getByRole('checkbox', { name: /Pieter van Wyk: Accept the job/ }).check();
  await add.getByRole('button', { name: 'Add finding' }).click();
  await expect(add).toHaveCount(0);
  return id;
}

async function promote(page: Page) {
  await page.getByRole('button', { name: `Add “${OFFLINE}” to company knowledge` }).click();
  const dialog = page.getByRole('dialog', { name: 'Add to company knowledge' });
  await expect(dialog).toContainText('as constraint, confirmed, with its quotes');
  await dialog.getByRole('button', { name: 'Add to company knowledge' }).click();
  await expect(dialog).toHaveCount(0);
}

const knowledge = (page: Page) => page.getByRole('list', { name: 'Company facts' });

test('a promoted finding shows on the client’s page and in its next engagement, with its source', async ({ page }) => {
  const id = await withFinding(page);
  await promote(page);
  const finding = page.locator('.ws-finding').filter({ hasText: OFFLINE });
  await expect(finding.getByRole('link', { name: 'In company knowledge' })).toHaveAttribute('href', `#/c/${id}`);
  // A finding is promoted once.
  await expect(page.getByRole('button', { name: `Add “${OFFLINE}” to company knowledge` })).toHaveCount(0);
  await expect
    .poll(() => Object.values(onDisk(id).knowledge).map((f) => [f.statement, f.status]))
    .toEqual([[OFFLINE, 'confirmed']]);

  await finding.getByRole('link', { name: 'In company knowledge' }).click();
  const fact = knowledge(page).getByRole('listitem').filter({ hasText: OFFLINE }).first();
  await expect(fact.locator('.ws-badge').first()).toHaveText('Constraint');
  await expect(fact.locator('.is-status')).toHaveText('Status: Confirmed');
  await expect(fact.locator('.is-provenance')).toHaveText('Provenance: Said in a session');
  await expect(fact).toContainText('From the record of Dispatch app');
  await expect(fact.getByRole('link', { name: 'Dispatch app' })).toHaveAttribute('href', `#/c/${id}/e/en_1/record`);
  await expect(fact.getByRole('list', { name: 'Quotes' })).toContainText(/Accept the job.*said by Pieter van Wyk, in Kick-off/);
  const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(scan.violations.map((v) => v.id)).toEqual([]);

  // The client's next engagement shows it.
  await page.getByRole('button', { name: 'New engagement' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New engagement' });
  await dialog.getByLabel('Name').fill('Fleet maintenance');
  await dialog.getByRole('button', { name: 'Add engagement' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Fleet maintenance' })).toBeVisible();
  const card = page.getByRole('region', { name: /What is known about Karoo Freight/ });
  await expect(card.getByRole('list', { name: 'Company facts' })).toContainText(OFFLINE);
  await expect(card.getByRole('button', { name: /Remove|Change/ })).toHaveCount(0);
  await expect(card.getByRole('link', { name: 'Change on the client’s page' })).toHaveAttribute('href', `#/c/${id}`);

  // Another client's engagement doesn't.
  const other = await kickoff(page);
  await page.goto(`/#/c/${other}/e/en_1`);
  await expect(page.getByRole('region', { name: /What is known about/ })).toContainText('Nothing yet.');
  await expect(page.getByText(OFFLINE)).toHaveCount(0);
});

test('a fact is changed and removed, each as an undoable step, and keeps what it was promoted from', async ({ page }) => {
  const id = await withFinding(page);
  await promote(page);
  await page.goto(`/#/c/${id}`);
  await page.getByRole('button', { name: `Change the company fact “${OFFLINE}”` }).click();
  const dialog = page.getByRole('dialog', { name: 'Change the company fact' });
  await dialog.getByLabel('Statement').fill('Dispatch must work offline on the N1.');
  await dialog.getByLabel('Status').selectOption({ label: 'Assumption' });
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).toHaveCount(0);
  const fact = knowledge(page).getByRole('listitem').filter({ hasText: 'Dispatch must work offline on the N1.' }).first();
  await expect(fact.locator('.is-status')).toHaveText('Status: Assumption');
  await expect(fact).toContainText(`first recorded as ${OFFLINE}`);
  await expect.poll(() => Object.values(onDisk(id).knowledge).map((f) => f.status)).toEqual(['assumption']);
  // The finding in the record didn't change.
  expect(Object.values(onDisk(id).findings).map((f) => f.statement)).toEqual([OFFLINE]);

  await page.getByRole('button', { name: 'Remove the company fact “Dispatch must work offline on the N1.”' }).click();
  await expect(page.getByText(/Nothing yet\. In an engagement’s record/)).toBeVisible();
  await expect.poll(() => Object.keys(onDisk(id).knowledge)).toEqual([]);
  await page.getByRole('button', { name: 'Undo Remove a company fact' }).click();
  await expect(knowledge(page)).toContainText('Dispatch must work offline on the N1.');
  await page.getByRole('button', { name: 'Undo Change a company fact' }).click();
  await expect(knowledge(page)).toContainText(OFFLINE);
  await expect(fact).toHaveCount(0);
});

test('deleting the finding leaves the fact, marked “source deleted” (decision 15)', async ({ page }) => {
  const id = await withFinding(page);
  await promote(page);
  await page.getByRole('button', { name: `Delete “${OFFLINE}”` }).click();
  await expect(page.getByText(/No findings yet/)).toBeVisible();
  await expect.poll(() => Object.values(onDisk(id).knowledge).map((f) => f.source.findingId)).toEqual([null]);
  await page.goto(`/#/c/${id}`);
  const fact = knowledge(page).getByRole('listitem').first();
  await expect(fact).toContainText(/From Dispatch app: source deleted \(/);
  // Its copied quote stays: the transcript is still there.
  await expect(fact.getByRole('list', { name: 'Quotes' })).toContainText('Pieter van Wyk');

  // Deleting a finding is an ordinary step: undo brings it back, and the link with it.
  await page.goto(`/#/c/${id}/e/en_1/record`);
  await page.getByRole('button', { name: 'Undo Delete a finding' }).click();
  await expect(
    page.locator('.ws-finding').filter({ hasText: OFFLINE }).getByRole('link', { name: 'In company knowledge' }),
  ).toBeVisible();
  await expect.poll(() => Object.values(onDisk(id).knowledge).map((f) => f.source.findingId)).not.toEqual([null]);
});

test('deleting the transcript takes the fact’s quotes from it, and lists the fact to review (C8, decision 11)', async ({
  page,
}) => {
  const id = await withFinding(page);
  await promote(page);
  await page.goto(`/#/c/${id}/e/en_1/s/se_1`);
  await page.getByRole('button', { name: 'Withdraw consent…' }).click();
  let dialog = page.getByRole('dialog', { name: 'Withdraw consent' });
  await dialog.getByLabel('Reason').fill('Pieter asked us to delete what he said.');
  await dialog.getByRole('button', { name: 'Record the withdrawal' }).click();
  dialog = page.getByRole('dialog', { name: 'Delete transcript…' });
  await expect(dialog).toContainText('0 findings and 1 company fact keep a statement from this session');
  await dialog.getByRole('button', { name: 'Delete transcript' }).click();

  dialog = page.getByRole('dialog', { name: 'What keeps a statement from this session' });
  const facts = dialog.getByRole('list', { name: 'Company facts' });
  await expect(facts).toContainText(OFFLINE);
  await expect(facts).toContainText('source deleted');
  await dialog.getByRole('button', { name: 'Done' }).click();

  await expect.poll(() => Object.values(onDisk(id).knowledge).map((f) => f.source.quotes.length)).toEqual([0]);
  expect(JSON.stringify(onDisk(id))).not.toContain('Accept the job');
  await page.goto(`/#/c/${id}`);
  const fact = knowledge(page).getByRole('listitem').first();
  await expect(fact).toContainText(OFFLINE);
  await expect(fact.getByRole('list', { name: 'Quotes' })).toHaveCount(0);
});

test('the export quotes the transcript with the speaker’s name and the session, at the meeting’s local time (WP9)', async ({
  page,
}) => {
  await withFinding(page);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export as Markdown' }).click();
  const text = readFileSync(await (await download).path(), 'utf8');
  expect(text).toMatch(/- \*\*Evidence:\*\* “Accept the job.*”, said by Pieter van Wyk in Kick-off\n/);
  expect(text).toContain('### Kick-off\n\n2026-11-05 10:00 (GMT+2)\n');
});

test('the company page’s knowledge works from the keyboard', async ({ page }) => {
  const id = await withFinding(page);
  await promote(page);
  await page.goto(`/#/c/${id}`);
  const change = page.getByRole('button', { name: `Change the company fact “${OFFLINE}”` });
  await change.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Change the company fact' });
  await expect(dialog.getByLabel('Statement')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(change).toBeFocused();
});
