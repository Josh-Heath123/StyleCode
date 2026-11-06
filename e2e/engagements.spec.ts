import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { E2E_WORKSPACE } from './workspaceFolder';

/**
 * Engagements, sessions and participants (MVP stories 1.4 and 2.1 to 2.3;
 * Phase 1 brief, WP6). Every client and person is role-played; names carry a
 * random suffix because tests share the test data folder.
 */
const unique = (name: string) => `${name} ${Math.random().toString(36).slice(2, 8)}`;

async function createClient(page: Page, name: string): Promise<string> {
  const res = await page.request.post('/api/workspace/companies', {
    headers: { 'x-stylecode-workspace': '1' },
    data: { profile: { name } },
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { workspace: { company: { id: string } } }).workspace.company.id;
}

const onDisk = (id: string) =>
  JSON.parse(readFileSync(join(E2E_WORKSPACE, 'companies', id, 'workspace.json'), 'utf8')) as {
    engagements: Record<string, { name: string; status: { state: string; endedOn?: string } }>;
    sessions: Record<string, { title: string; startsAt: string }>;
    participants: Record<string, { name: string; role: string; side: string }>;
  };

const saved = (page: Page) => expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();

async function newEngagement(page: Page, name: string, goal = '') {
  await page.getByRole('button', { name: 'New engagement' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New engagement' });
  await dialog.getByLabel('Name').fill(name);
  if (goal) await dialog.getByLabel(/Goal/).fill(goal);
  await dialog.getByRole('button', { name: 'Add engagement' }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

async function newSession(page: Page, title: string, starts: string) {
  await page.getByRole('button', { name: 'New session' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New session' });
  await dialog.getByLabel('Title').fill(title);
  await dialog.getByLabel('Starts').fill(starts);
  await dialog.getByRole('button', { name: 'Add session' }).click();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
}

async function addParticipant(page: Page, name: string, role: string, side: 'client' | 'consultant') {
  await page.getByRole('button', { name: 'Add participant' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add participant' });
  if (side === 'consultant') await dialog.getByLabel(/^Yours/).check();
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByLabel(/Role/).fill(role);
  await dialog.getByRole('button', { name: 'Add participant' }).click();
  await expect(dialog).toBeHidden();
}

test('an engagement: created from an empty client, edited, ended, listed newest first, and counted on the clients list', async ({
  page,
}) => {
  const client = unique('Harbour Bakery');
  const id = await createClient(page, client);
  await page.goto(`/#/c/${id}`);
  await expect(page.getByText(/No engagements yet\. An engagement is one piece of work/)).toBeVisible();

  await newEngagement(page, 'Stock across three shops');
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('listitem')).toHaveText([
    'Clients',
    client,
    'Stock across three shops',
  ]);
  await page.getByRole('textbox', { name: 'Goal', exact: true }).fill('Replace the stock spreadsheet.');
  await page.getByRole('textbox', { name: 'Goal', exact: true }).blur();
  await page.getByLabel('Ended on').check();
  await page.getByLabel('Date it ended').fill('2026-09-30');
  await saved(page);
  const stock = Object.values(onDisk(id).engagements)[0];
  expect(stock.status).toEqual({ state: 'ended', endedOn: '2026-09-30' });

  await page.getByRole('link', { name: client }).click();
  await newEngagement(page, 'Online ordering', 'Take cake orders online.');
  await page.getByRole('link', { name: client }).click();
  const rows = page.getByRole('list', { name: 'Engagements' }).getByRole('listitem');
  await expect(rows.nth(0)).toContainText('Online ordering');
  await expect(rows.nth(0)).toContainText('Active');
  await expect(rows.nth(1)).toContainText('Stock across three shops');
  await expect(rows.nth(1)).toContainText(/Ended (30 Sept? 2026|Sep 30, 2026)/);

  await page.getByRole('link', { name: 'Clients', exact: true }).first().click();
  await expect(page.getByRole('link', { name: new RegExp(client) })).toContainText('1 active engagement');
});

test('a session: created with a time, participants on both sides edited and removed, listed with its consent state', async ({
  page,
}) => {
  const client = unique('Quay Coffee');
  const id = await createClient(page, client);
  await page.goto(`/#/c/${id}`);
  await newEngagement(page, 'Wholesale orders');
  await expect(page.getByText(/No sessions yet\. Add one for each meeting/)).toBeVisible();
  await newSession(page, 'Kick-off', '2026-11-04T09:00');
  await expect(page.getByText(/No participants yet\..*At least one person from the client/)).toBeVisible();

  await addParticipant(page, 'Alex Owner', 'Owner', 'client');
  await addParticipant(page, 'Sam Consultant', 'Consultant', 'consultant');
  const people = page.getByRole('list', { name: 'Participants' }).getByRole('listitem');
  await expect(people).toHaveCount(2);
  await expect(people.nth(0)).toContainText(`Owner, ${client}`);
  await expect(people.nth(0)).toContainText('Client');
  await expect(people.nth(1)).toContainText('Your side');

  await page.getByRole('button', { name: 'Edit Alex Owner' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit Alex Owner' });
  await edit.getByLabel(/Role/).fill('Owner and head baker');
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(people.nth(0)).toContainText('Owner and head baker');

  // Removing someone is an ordinary step: it can be undone.
  await page.getByRole('button', { name: 'Remove Sam Consultant' }).click();
  await expect(people).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo Remove Sam Consultant' }).click();
  await expect(people).toHaveCount(2);
  await saved(page);
  expect(
    Object.values(onDisk(id).participants)
      .map((p) => p.role)
      .sort(),
  ).toEqual(['Consultant', 'Owner and head baker']);

  await page.getByRole('link', { name: 'Wholesale orders' }).click();
  const row = page.getByRole('list', { name: 'Sessions' }).getByRole('listitem');
  await expect(row).toContainText('Kick-off');
  await expect(row).toContainText('2 participants');
  await expect(row).toContainText('Consent not filled in');
});

test('deleting a session or an engagement names what goes, can’t be undone, and clears the undo history', async ({ page }) => {
  const id = await createClient(page, unique('Fynbos Physio'));
  await page.goto(`/#/c/${id}`);
  await newEngagement(page, 'Bookings');
  await newSession(page, 'First visit', '2026-11-05T10:00');
  await addParticipant(page, 'Pat Physio', 'Practice manager', 'client');

  await page.getByRole('button', { name: 'Delete session…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete session…' });
  await expect(dialog).toContainText('This deletes the session First visit');
  await expect(dialog).toContainText('1 participant');
  await expect(dialog).toContainText('This can’t be undone');
  await dialog.getByRole('button', { name: 'Delete session' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Bookings' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nothing to undo' })).toBeDisabled();
  await saved(page);
  expect(onDisk(id).sessions).toEqual({});
  expect(onDisk(id).participants).toEqual({});

  await page.getByRole('button', { name: 'Delete engagement…' }).click();
  const engagement = page.getByRole('dialog', { name: 'Delete engagement…' });
  await expect(engagement).toContainText('This deletes Bookings and everything in it: 0 sessions');
  await engagement.getByRole('button', { name: 'Cancel' }).click();
  await expect(engagement).toBeHidden();
  await page.getByRole('button', { name: 'Delete engagement…' }).click();
  await engagement.getByRole('button', { name: 'Delete engagement' }).click();
  await expect(page.getByText(/No engagements yet/)).toBeVisible();
  await saved(page);
  expect(onDisk(id).engagements).toEqual({});
});

test('deleting a client needs its name typed, and removes its folder', async ({ page }) => {
  const client = unique('Cape Kites');
  const id = await createClient(page, client);
  await page.goto(`/#/c/${id}`);
  await page.getByRole('button', { name: 'Delete client…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete client…' });
  // A copied folder has the same name as the original, so the folder id is shown too.
  await expect(dialog).toContainText(`This deletes ${client} (folder ${id}) and everything in it`);
  await expect(dialog).toContainText('This can’t be undone.');
  const remove = dialog.getByRole('button', { name: 'Delete client' });
  await expect(remove).toBeDisabled();
  await dialog.getByLabel(`Type ${client} to confirm`).fill(client.toUpperCase());
  await expect(remove).toBeDisabled();
  await dialog.getByLabel(`Type ${client} to confirm`).fill(client);
  await remove.click();

  await expect(page.getByRole('heading', { level: 1, name: 'Clients' })).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(client) })).toHaveCount(0);
  expect(existsSync(join(E2E_WORKSPACE, 'companies', id))).toBe(false);
});

test('a deletion whose save is refused says so in its dialog, instead of looking done (Phase 1 review)', async ({ page }) => {
  const id = await createClient(page, unique('Refused Save'));
  await page.goto(`/#/c/${id}`);
  await newEngagement(page, 'Bookings');
  await newSession(page, 'First visit', '2026-11-05T10:00');
  await saved(page);

  // The next save is refused, as when the client was changed in another window.
  await page.route(`**/api/workspace/companies/${id}`, (route) =>
    route.request().method() === 'PUT'
      ? route.fulfill({
          status: 409,
          json: { error: 'This client was changed in another window. Reload it to see the latest version.' },
        })
      : route.fallback(),
  );
  await page.getByRole('button', { name: 'Delete session…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete session…' });
  await dialog.getByRole('button', { name: 'Delete session' }).click();
  await expect(dialog.getByRole('alert')).toHaveText(
    'Not saved: This client was changed in another window. Reload it to see the latest version.',
  );
  await expect(page).toHaveURL(/\/s\//);
});
