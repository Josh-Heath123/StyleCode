import AxeBuilder from '@axe-core/playwright';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { E2E_WORKSPACE } from './workspaceFolder';

/**
 * Documents on a company and on an engagement (MVP Q2; Phase 1 brief, WP10).
 * Every client and file is role-played.
 */
const HEADERS = { 'x-stylecode-workspace': '1' };

async function clientWithEngagement(page: Page): Promise<string> {
  const res = await page.request.post('/api/workspace/companies', {
    headers: HEADERS,
    data: { profile: { name: `Harbour Bakery ${Math.random().toString(36).slice(2, 8)}` } },
  });
  const opened = (await res.json()) as { workspace: Record<string, unknown> & { company: { id: string } }; revision: string };
  const ws = opened.workspace;
  const at = '2026-11-04T09:00:00.000Z';
  ws.engagements = {
    en_1: {
      id: 'en_1',
      companyId: ws.company.id,
      name: 'Online ordering',
      goal: '',
      status: { state: 'active' },
      createdAt: at,
      updatedAt: at,
    },
  };
  await page.request.put(`/api/workspace/companies/${ws.company.id}`, {
    headers: HEADERS,
    data: { workspace: ws, baseRevision: opened.revision },
  });
  await page.request.put('/api/workspace/settings', { headers: HEADERS, data: { consultantName: 'Sam Consultant' } });
  return ws.company.id;
}

const filesOnDisk = (id: string) => readdirSync(join(E2E_WORKSPACE, 'companies', id, 'files')).filter((n) => !n.endsWith('.tmp'));
const listed = (id: string) =>
  Object.values(
    (
      JSON.parse(readFileSync(join(E2E_WORKSPACE, 'companies', id, 'workspace.json'), 'utf8')) as {
        files: Record<string, { name: string; owner: { kind: string } }>;
      }
    ).files,
  );

async function attach(page: Page, name: string, text: string, mimeType = 'text/plain') {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add file…' }).click();
  await (await chooser).setFiles({ name, mimeType, buffer: Buffer.from(text) });
  await expect(page.getByRole('list', { name: 'Files' })).toContainText(name);
}

test('a document on a company: added (saved at once, not undoable), downloaded, removed', async ({ page }) => {
  const id = await clientWithEngagement(page);
  await page.goto(`/#/c/${id}`);
  await expect(page.getByText(/No files yet\. Add documents about this client/)).toBeVisible();
  await expect(page.getByText('Adding or removing a file saves straight away and can’t be undone.')).toBeVisible();

  await page.getByRole('textbox', { name: 'Industry', exact: true }).fill('Bakery');
  await page.getByRole('textbox', { name: 'Industry', exact: true }).press('Enter');
  await attach(page, 'Brief.txt', 'Three bakeries and a cake shop online.');
  const row = page.getByRole('list', { name: 'Files' }).getByRole('listitem').first();
  await expect(row).toContainText(/38 bytes · added by Sam Consultant/);
  // Saved at once, and no undo can take the entry (and its bytes) away.
  await expect.poll(() => listed(id).map((f) => f.name)).toEqual(['Brief.txt']);
  await expect.poll(() => filesOnDisk(id)).toHaveLength(1);
  await expect(page.getByRole('button', { name: 'Nothing to undo' })).toBeDisabled();

  const download = page.waitForEvent('download');
  await row.getByRole('button', { name: 'Download Brief.txt' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('Brief.txt');
  expect(readFileSync(await file.path(), 'utf8')).toBe('Three bakeries and a cake shop online.');

  await row.getByRole('button', { name: 'Remove Brief.txt' }).click();
  const dialog = page.getByRole('dialog', { name: 'Remove file…' });
  await expect(dialog).toContainText('This removes Brief.txt (38 bytes) from this client’s folder.');
  await expect(dialog).toContainText('This can’t be undone');
  const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(scan.violations.map((v) => v.id)).toEqual([]);
  await dialog.getByRole('button', { name: 'Remove file' }).click();
  await expect(page.getByText(/No files yet/)).toBeVisible();
  await expect.poll(() => listed(id)).toEqual([]);
  await expect.poll(() => filesOnDisk(id)).toEqual([]);
  await expect(page.getByRole('button', { name: 'Nothing to undo' })).toBeDisabled();
});

test('a document on an engagement, kept apart from the company’s; an HTML file is downloaded, never opened', async ({ page }) => {
  const id = await clientWithEngagement(page);
  await page.goto(`/#/c/${id}/e/en_1`);
  await attach(page, 'Mock-up.html', '<script>document.title = "ran"</script>', 'text/html');
  await expect.poll(() => listed(id)).toMatchObject([{ name: 'Mock-up.html', owner: { kind: 'engagement' } }]);

  const pages = page.context().pages().length;
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Mock-up.html' }).click();
  expect((await download).suggestedFilename()).toBe('Mock-up.html');
  expect(page.context().pages()).toHaveLength(pages);
  expect(await page.title()).not.toBe('ran');

  // Removed from the engagement, its bytes go with it.
  await page.getByRole('button', { name: 'Remove Mock-up.html' }).click();
  await page.getByRole('dialog', { name: 'Remove file…' }).getByRole('button', { name: 'Remove file' }).click();
  await expect(page.getByText(/No files yet\. Add documents for this engagement/)).toBeVisible();
  await expect.poll(() => listed(id)).toEqual([]);
  await expect.poll(() => filesOnDisk(id)).toEqual([]);

  // The company page lists only the company's own files.
  await page.getByRole('link', { name: /^Harbour Bakery/ }).click();
  await expect(page.getByText(/No files yet/)).toBeVisible();
});

test('a read-only client’s files can be downloaded, not added or removed', async ({ page }) => {
  const id = await clientWithEngagement(page);
  await page.goto(`/#/c/${id}`);
  await attach(page, 'Contract.txt', 'Signed.');
  await expect.poll(() => listed(id)).toHaveLength(1);
  // Break the file, so the client opens read-only.
  const file = join(E2E_WORKSPACE, 'companies', id, 'workspace.json');
  const ws = JSON.parse(readFileSync(file, 'utf8')) as { engagements: Record<string, { status: unknown }> };
  ws.engagements.en_1.status = { state: 'paused' };
  const { writeFileSync } = await import('node:fs');
  writeFileSync(file, JSON.stringify(ws));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'This client opens read-only' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download Contract.txt' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Add file|Remove/ })).toHaveCount(0);
  expect(existsSync(file)).toBe(true);
});
