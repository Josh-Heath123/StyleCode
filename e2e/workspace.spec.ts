import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { E2E_WORKSPACE } from './workspaceFolder';

/**
 * The workspace pages: the clients list, a client, settings, and the way to
 * the editor and back (Phase 1 brief, WP5). Every client here is role-played,
 * and names carry a random suffix because tests share the test data folder.
 */
const HEADERS = { 'x-stylecode-workspace': '1' };
const unique = (name: string) => `${name} ${Math.random().toString(36).slice(2, 8)}`;

async function createClient(page: Page, name: string): Promise<string> {
  const res = await page.request.post('/api/workspace/companies', { headers: HEADERS, data: { profile: { name } } });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { workspace: { company: { id: string } } }).workspace.company.id;
}

test('StyleCode opens on the clients list, and a new client opens on its own page', async ({ page }) => {
  // An empty data folder, as on first use (other tests share the real test folder).
  await page.route('**/api/workspace/companies', (route) =>
    route.request().method() === 'GET' ? route.fulfill({ json: { companies: [] } }) : route.fallback(),
  );
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Clients' })).toBeFocused();
  await expect(page.getByRole('heading', { name: 'No clients yet' })).toBeVisible();
  await expect(page.getByText(`Client data folder: ${E2E_WORKSPACE}`)).toBeVisible();

  const name = unique('Harbour Bakery');
  await page.getByRole('button', { name: 'New client' }).click();
  const dialog = page.getByRole('dialog', { name: 'New client' });
  await expect(dialog.getByLabel('Name')).toBeFocused();
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByLabel(/Industry/).fill('Food retail');
  await dialog.getByRole('button', { name: 'Add client' }).click();

  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await expect(page).toHaveURL(/#\/c\/co_/);
  const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
  await expect(crumbs.getByRole('listitem')).toHaveText(['Clients', name]);
  await expect(crumbs.getByRole('link', { name: 'Clients' })).toHaveAttribute('href', '#/');
  await expect(page.getByRole('textbox', { name: 'Industry', exact: true })).toHaveValue('Food retail');
});

test('a client name another client has is refused, ignoring case', async ({ page }) => {
  const name = unique('Quay Coffee');
  await createClient(page, name);
  await page.goto('/');
  await page.getByRole('link', { name: new RegExp(name) }).waitFor();
  await page.getByRole('button', { name: 'New client' }).click();
  const dialog = page.getByRole('dialog', { name: 'New client' });
  await dialog.getByLabel('Name').fill(name.toUpperCase());
  await dialog.getByLabel('Name').press('Enter');
  await expect(dialog.getByRole('alert')).toHaveText(`There is already a client called ${name.toUpperCase()}.`);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'New client' })).toBeFocused();
});

test('profile changes save on their own, survive a reload, and undo as one step each', async ({ page }) => {
  const id = await createClient(page, unique('Fynbos Physio'));
  await page.goto(`/#/c/${id}`);

  const industry = page.getByRole('textbox', { name: 'Industry', exact: true });
  await industry.fill('Healthcare');
  await industry.press('Enter');
  await page.getByRole('textbox', { name: 'Notes', exact: true }).fill('Two practices; Sam leads.');
  await page.getByRole('textbox', { name: 'Notes', exact: true }).blur();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Industry', exact: true })).toHaveValue('Healthcare');
  await expect(page.getByRole('textbox', { name: 'Notes', exact: true })).toHaveValue('Two practices; Sam leads.');

  // A freshly opened client has nothing to undo; changes made now undo one at a time.
  await expect(page.getByRole('button', { name: 'Nothing to undo' })).toBeDisabled();
  await page.getByRole('textbox', { name: 'Industry', exact: true }).fill('Physiotherapy');
  await page.getByRole('textbox', { name: 'Industry', exact: true }).press('Enter');
  await page.getByRole('heading', { level: 1 }).click();
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('textbox', { name: 'Industry', exact: true })).toHaveValue('Healthcare');
  await page.getByRole('button', { name: 'Redo Change the industry' }).click();
  await expect(page.getByRole('textbox', { name: 'Industry', exact: true })).toHaveValue('Physiotherapy');
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Industry', exact: true })).toHaveValue('Physiotherapy');
});

test('renaming a client to another client’s name is refused', async ({ page }) => {
  const taken = unique('Kalk Bay Books');
  await createClient(page, taken);
  const id = await createClient(page, unique('Muizenberg Surf'));
  await page.goto(`/#/c/${id}`);
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill(taken.toLowerCase());
  await page.getByRole('textbox', { name: 'Name', exact: true }).press('Enter');
  await expect(page.getByText(`There is already a client called ${taken.toLowerCase()}.`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nothing to undo' })).toBeDisabled();
});

test('a client whose file has problems opens read-only, with the problems listed', async ({ page }) => {
  const name = unique('Broken Client');
  const id = await createClient(page, name);
  const file = join(E2E_WORKSPACE, 'companies', id, 'workspace.json');
  const ws = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  ws.engagements = {
    en_1: {
      id: 'en_1',
      companyId: id,
      name: 'Paused work',
      goal: '',
      status: { state: 'paused' },
      createdAt: 'x',
      updatedAt: 'x',
    },
  };
  const at = new Date().toISOString();
  ws.sessions = {
    se_1: { id: 'se_1', engagementId: 'en_1', title: 'Kick-off', startsAt: at, audioFileIds: [], createdAt: at, updatedAt: at },
  };
  writeFileSync(file, JSON.stringify(ws));

  await page.goto('/');
  const row = page.getByRole('link', { name: new RegExp(name) });
  await expect(row).toContainText('Has problems · opens read-only');
  await row.click();
  await expect(page.getByRole('heading', { name: 'This client opens read-only' })).toBeVisible();
  // Read-only looks read-only: the profile is text, not fields, and nothing offers to change it.
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.getByText(name, { exact: true }).last()).toBeVisible();
  await expect(page.getByText('Read-only', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /undo|New engagement/i })).toHaveCount(0);
  // Each problem says what to do.
  // (Its engagement has an unknown status and unreadable times: two problems.)
  const problems = page.locator('.ws-problems li');
  await expect(problems).toHaveCount(2);
  for (const problem of await problems.all())
    await expect(problem).toContainText('What to do: restore the client’s folder from a backup');

  // Its consent form can't be filled in either, even reached directly.
  await page.goto(`/#/c/${id}/e/en_1/s/se_1/consent`);
  await expect(
    page.getByText('This session has no consent record, and this client is read-only, so none can be filled in.'),
  ).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Save/ })).toHaveCount(0);
});

test('a copied client folder opens read-only, saying to rename it back or remove the copy', async ({ page }) => {
  const id = await createClient(page, unique('Copied Client'));
  const copy = `co_${Math.random().toString(36).slice(2, 8)}x1`;
  cpSync(join(E2E_WORKSPACE, 'companies', id), join(E2E_WORKSPACE, 'companies', copy), { recursive: true });
  await page.goto(`/#/c/${copy}`);
  const problem = page.locator('.ws-problems li');
  await expect(problem).toContainText(`The folder is named ${copy}, but the file inside it belongs to the client ${id}.`);
  await expect(problem).toContainText(
    `rename it back to ${id}. If it is a copy of that client’s folder, remove the copy: Delete client… on this page removes this folder, ${copy}, and leaves the original alone.`,
  );
  // Ids are monospace, so an "x" stays an "x".
  await expect(problem.locator('code.ws-id').first()).toHaveText(copy);
  await expect(problem.locator('code.ws-id').first()).toHaveCSS('font-family', /monospace|Cascadia|Consolas|Menlo/);

  // Deleting the copy removes the copy's folder, never the original's.
  await page.getByRole('button', { name: 'Delete client…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete client…' });
  await expect(dialog).toContainText(`(folder ${copy})`);
  const clientName = (await page.getByRole('heading', { level: 1 }).textContent()) ?? '';
  await dialog.getByLabel(`Type ${clientName} to confirm`).fill(clientName);
  await dialog.getByRole('button', { name: 'Delete client' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Clients' })).toBeVisible();
  expect(existsSync(join(E2E_WORKSPACE, 'companies', copy))).toBe(false);
  expect(existsSync(join(E2E_WORKSPACE, 'companies', id, 'workspace.json'))).toBe(true);
});

test('the design editor is one click away, and Clients leads back to the page that was open', async ({ page }) => {
  const name = unique('Cape Kites');
  const id = await createClient(page, name);
  await page.goto(`/#/c/${id}`);
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await page.getByRole('textbox', { name: 'Industry', exact: true }).fill('Kite making');
  await page.getByRole('textbox', { name: 'Industry', exact: true }).press('Enter');
  await page.getByRole('link', { name: 'Design editor' }).click();
  await page.waitForSelector('.canvas');
  await expect(page.getByRole('link', { name: 'Design editor' })).toHaveAttribute('aria-current', 'page');

  // Back at the client, its undo history is as it was.
  await page.getByRole('link', { name: 'Clients' }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await page.getByRole('button', { name: 'Undo Change the industry' }).click();
  await expect(page.getByRole('textbox', { name: 'Industry', exact: true })).toHaveValue('');
  // The browser's back button works between them.
  await page.goBack();
  await page.waitForSelector('.canvas');
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
});

test('without the workspace server, StyleCode opens on the editor and says what client work needs', async ({ page }) => {
  await page.route('**/api/workspace/info', (route) => route.fulfill({ status: 404, body: 'Not found' }));
  await page.goto('/');
  await page.waitForSelector('.canvas');
  await expect(page.getByText('Client work needs StyleCode running on your computer (npm start).')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Clients' })).toHaveCount(0);
});

test('settings keep the consultant’s name and show the data folder', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  await expect(page.locator('.ws-path')).toHaveText(E2E_WORKSPACE);
  const consultant = unique('Sam Consultant');
  await page.getByLabel('Your name').fill(consultant);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Your name is saved.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Your name')).toHaveValue(consultant);
});

test('in a copied folder, every link stays in the copy, never the original client (Phase 1 review)', async ({ page }) => {
  const id = await createClient(page, unique('Linked Copy'));
  // The original has an engagement with a session, then its folder is copied.
  const file = join(E2E_WORKSPACE, 'companies', id, 'workspace.json');
  const ws = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  const at = new Date().toISOString();
  ws.engagements = {
    en_1: {
      id: 'en_1',
      companyId: id,
      name: 'Online ordering',
      goal: '',
      status: { state: 'active' },
      createdAt: at,
      updatedAt: at,
    },
  };
  ws.sessions = {
    se_1: { id: 'se_1', engagementId: 'en_1', title: 'Kick-off', startsAt: at, audioFileIds: [], createdAt: at, updatedAt: at },
  };
  writeFileSync(file, JSON.stringify(ws));
  const copy = `co_${Math.random().toString(36).slice(2, 8)}x2`;
  cpSync(join(E2E_WORKSPACE, 'companies', id), join(E2E_WORKSPACE, 'companies', copy), { recursive: true });

  await page.goto(`/#/c/${copy}`);
  await page.getByRole('link', { name: /Online ordering/ }).click();
  await expect(page).toHaveURL(new RegExp(`#/c/${copy}/e/en_1$`));
  await page.getByRole('link', { name: /Kick-off/ }).click();
  await expect(page).toHaveURL(new RegExp(`#/c/${copy}/e/en_1/s/se_1$`));
  await expect(page.getByRole('heading', { name: 'This client opens read-only' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Online ordering' }).click();
  await expect(page).toHaveURL(new RegExp(`#/c/${copy}/e/en_1$`));
  await page.getByRole('link', { name: 'Open the record' }).click();
  await expect(page).toHaveURL(new RegExp(`#/c/${copy}/e/en_1/record$`));
});

test('a data folder inside a cloud-synced folder shows a warning on every workspace page, and settings say what to do', async ({
  page,
}) => {
  await page.route('**/api/workspace/info', async (route) => {
    const real = (await (await route.fetch()).json()) as Record<string, unknown>;
    await route.fulfill({ json: { ...real, cloudService: 'OneDrive' } });
  });
  await page.goto('/');
  const warning = page.getByRole('note').filter({ hasText: 'Your data folder is inside OneDrive' });
  await expect(warning).toContainText('so client data is copied to OneDrive’s servers.');
  await warning.getByRole('link', { name: 'What to do' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  await expect(page.getByText(/This folder is inside OneDrive\./)).toBeVisible();
  await expect(page.getByText(/This warning stays until the folder moves\./)).toBeVisible();
});
