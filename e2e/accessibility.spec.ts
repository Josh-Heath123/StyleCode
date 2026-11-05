import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { findByName, selected, snapshot } from './helpers';

/**
 * Automated checks (axe-core, WCAG 2.1 A and AA) on every part of the editor
 * chrome, and the editor driven from the keyboard alone. The designs on the
 * canvas are the user's own work, so their colours are left out of the scan.
 */

async function openExample(page: Page): Promise<void> {
  await page.goto('/#/editor');
  await page.waitForSelector('.canvas');
  await page.getByRole('button', { name: 'Designs' }).click();
  await page.getByRole('menuitem', { name: 'New example design' }).click();
  await expect.poll(async () => Object.keys((await snapshot(page)).doc.nodes).length).toBeGreaterThan(10);
}

async function scan(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .exclude('.canvas-content')
    .exclude('.preview iframe')
    .analyze();
  const problems = results.violations.map(
    (v) =>
      `${v.id}: ${v.help}\n${v.nodes.map((n) => `  ${n.target.join(' ')} — ${n.failureSummary?.split('\n')[1] ?? ''}`).join('\n')}`,
  );
  expect(problems, `${label} has accessibility problems`).toEqual([]);
}

test.describe('accessibility checks', () => {
  test.beforeEach(async ({ page }) => openExample(page));

  test('the editor, with a layer selected and with the code open', async ({ page }) => {
    const heading = findByName(await snapshot(page), 'Hero heading') ?? findByName(await snapshot(page), 'Heading');
    await page.evaluate(
      (id) =>
        (window as unknown as { stylecode: { editor: { select(ids: string[]): void } } }).stylecode.editor.select(id ? [id] : []),
      heading?.id,
    );
    await scan(page, 'The editor');
    await page.getByRole('tab', { name: 'Code' }).click();
    await scan(page, 'The code panel');
  });

  test('the dialogs and menus', async ({ page }) => {
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
    await scan(page, 'Keyboard shortcuts');
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Designs' }).click();
    await page.getByRole('menuitem', { name: /All designs/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await scan(page, 'Projects');
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Preview', exact: true }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await scan(page, 'Preview');
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Help' }).click();
    await expect(page.getByRole('menu')).toBeVisible();
    await scan(page, 'Help menu');
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: /^AI settings/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await scan(page, 'AI settings');
    await page.keyboard.press('Escape');

    await page.keyboard.press('/');
    await expect(page.getByRole('region', { name: 'AI assistant' })).toBeVisible();
    await scan(page, 'AI assistant');
  });

  test('the welcome screen and the getting-started checklist', async ({ page }) => {
    await page.evaluate(() => localStorage.removeItem('stylecode.onboarding'));
    await page.reload();
    await expect(page.getByRole('dialog', { name: 'Welcome to StyleCode' })).toBeVisible();
    await scan(page, 'Welcome');
    await page.getByRole('button', { name: 'Start with a blank canvas' }).click();
    await expect(page.getByRole('region', { name: 'Getting started' })).toBeVisible();
    await scan(page, 'Checklist');
  });
});

test.describe('the workspace pages', () => {
  test('the clients list, the new client dialog, a client and settings', async ({ page }) => {
    const name = `Accessible Bakery ${Math.random().toString(36).slice(2, 8)}`;
    const res = await page.request.post('/api/workspace/companies', {
      headers: { 'x-stylecode-workspace': '1' },
      data: { profile: { name, industry: 'Food retail' } },
    });
    const id = ((await res.json()) as { workspace: { company: { id: string } } }).workspace.company.id;

    await page.goto('/');
    await page.getByRole('link', { name: new RegExp(name) }).waitFor();
    await scan(page, 'The clients list');

    // From the keyboard: the New client button opens its dialog, which keeps focus and gives it back.
    const add = page.getByRole('button', { name: 'New client' });
    await add.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'New client' });
    await expect(dialog.getByLabel('Name')).toBeFocused();
    await scan(page, 'New client');
    for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(add).toBeFocused();

    await page.goto(`/#/c/${id}`);
    await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();
    await scan(page, 'A client');

    await page.goto('/#/settings');
    await expect(page.getByRole('heading', { name: 'Where client data is kept' })).toBeVisible();
    await scan(page, 'Settings');
  });

  test('an engagement and a session, with their dialogs, all from the keyboard', async ({ page }) => {
    const name = `Accessible Physio ${Math.random().toString(36).slice(2, 8)}`;
    const res = await page.request.post('/api/workspace/companies', {
      headers: { 'x-stylecode-workspace': '1' },
      data: { profile: { name } },
    });
    const id = ((await res.json()) as { workspace: { company: { id: string } } }).workspace.company.id;
    await page.goto(`/#/c/${id}`);

    // New engagement, from the keyboard alone.
    await page.getByRole('button', { name: 'New engagement' }).focus();
    await page.keyboard.press('Enter');
    const engagement = page.getByRole('dialog', { name: 'New engagement' });
    await expect(engagement.getByLabel('Name')).toBeFocused();
    await scan(page, 'New engagement');
    await page.keyboard.type('Bookings');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: 'Bookings' })).toBeVisible();
    await scan(page, 'An engagement');

    await page.getByRole('button', { name: 'New session' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'New session' }).getByLabel('Title')).toBeFocused();
    await scan(page, 'New session');
    await page.keyboard.type('First visit');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: 'First visit' })).toBeVisible();

    await page.getByRole('button', { name: 'Add participant' }).focus();
    await page.keyboard.press('Enter');
    const participant = page.getByRole('dialog', { name: 'Add participant' });
    await expect(participant).toBeVisible();
    await scan(page, 'Add participant');
    await participant.getByLabel('Name').fill('Pat Physio');
    await page.keyboard.press('Enter');
    await expect(participant).toBeHidden();
    await scan(page, 'A session');

    await page.getByRole('button', { name: 'Delete session…' }).click();
    await scan(page, 'Delete session');
    await page.keyboard.press('Escape');
    await page.getByRole('link', { name }).click();
    await page.getByRole('button', { name: 'Delete client…' }).click();
    await scan(page, 'Delete client');
  });
});

test.describe('keyboard only', () => {
  test.beforeEach(async ({ page }) => openExample(page));

  test('moves through the layer tree, renames a layer and edits a property', async ({ page }) => {
    const tree = page.getByRole('tree', { name: 'Layers' });
    await tree.focus();
    await page.keyboard.press('Home');
    const first = (await selected(page))[0];
    expect(first).toBeTruthy();
    await expect(tree).toHaveAttribute('aria-activedescendant', `layer-${first}`);

    // Into the frame and down to its first child.
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    const child = (await selected(page))[0];
    expect((await snapshot(page)).doc.nodes[child].parentId).toBe(first);

    // Arrow keys move through the list; they don't nudge the layer on the canvas.
    const before = (await snapshot(page)).doc.nodes[child];
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    expect((await selected(page))[0]).toBe(child);
    expect((await snapshot(page)).doc.nodes[child].x).toBe(before.x);

    // Shift+Down extends the selection.
    await page.keyboard.press('Shift+ArrowDown');
    expect(await selected(page)).toHaveLength(2);
    await page.keyboard.press('ArrowUp');

    // Enter renames, and focus comes back to the tree.
    await page.keyboard.press('Enter');
    await page.keyboard.press('Control+a');
    await page.keyboard.type('Renamed from the keyboard');
    await page.keyboard.press('Enter');
    expect((await snapshot(page)).doc.nodes[child].name).toBe('Renamed from the keyboard');
    await expect(tree).toBeFocused();

    // Left closes the layer if it is open, then goes back to its parent.
    await page.keyboard.press('ArrowLeft');
    if ((await selected(page))[0] === child) await page.keyboard.press('ArrowLeft');
    expect(await selected(page)).toEqual([first]);

    // The properties panel is ordinary form fields: change the width.
    const width = page.getByRole('textbox', { name: 'Width', exact: true }).first();
    await width.focus();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('900');
    await page.keyboard.press('Enter');
    expect((await snapshot(page)).doc.nodes[first].width).toBe(900);
  });

  test('Tab on the canvas walks through the layers and then lets focus go', async ({ page }) => {
    await page.evaluate(() =>
      (window as unknown as { stylecode: { editor: { select(ids: string[]): void } } }).stylecode.editor.select([]),
    );
    const canvas = page.getByRole('application', { name: 'Design canvas' });
    await canvas.focus();
    await page.keyboard.press('Tab');
    const snap = await snapshot(page);
    const pages = snap.doc.nodes[snap.doc.rootId].children;
    expect(await selected(page)).toEqual([pages[0]]);

    // Into the page, and Tab moves between its children.
    await page.keyboard.press('Enter');
    const children = snap.doc.nodes[pages[0]].children;
    await page.keyboard.press('Escape');
    await page.keyboard.press('Enter');
    expect((await selected(page)).length).toBe(children.length);
    await page.evaluate(
      (id) => (window as unknown as { stylecode: { editor: { select(ids: string[]): void } } }).stylecode.editor.select([id]),
      children[0],
    );
    await page.keyboard.press('Tab');
    expect(await selected(page)).toEqual([children[1]]);
    await page.keyboard.press('Shift+Tab');
    expect(await selected(page)).toEqual([children[0]]);

    // At the last layer, Tab leaves the canvas instead of trapping focus.
    await page.evaluate(
      (id) => (window as unknown as { stylecode: { editor: { select(ids: string[]): void } } }).stylecode.editor.select([id]),
      children[children.length - 1],
    );
    await page.keyboard.press('Tab');
    await expect(canvas).not.toBeFocused();
  });

  test('announces the selection to screen readers', async ({ page }) => {
    const status = page.locator('[role="status"][aria-live="polite"]').first();
    const tree = page.getByRole('tree', { name: 'Layers' });
    await tree.focus();
    await page.keyboard.press('Home');
    await expect(status).toContainText('page frame, selected');
    await page.keyboard.press('Shift+ArrowDown');
    await expect(status).toHaveText('2 layers selected');
  });

  test('dialogs keep focus inside and give it back when they close', async ({ page }) => {
    const help = page.getByRole('button', { name: 'Help' });
    await help.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('menuitem', { name: /Keyboard shortcuts/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(page.getByRole('searchbox', { name: 'Find a shortcut' })).toBeFocused();
    for (let i = 0; i < 4; i++) await page.keyboard.press('Tab');
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    // Opened from a menu item: focus goes back to the menu's button.
    await expect(help).toBeFocused();

    // The preview's page is out of the Tab order, so Tab stays in the dialog and Escape still closes it.
    await page.getByRole('button', { name: 'Preview', exact: true }).first().click();
    const preview = page.getByRole('dialog', { name: /Preview/ });
    await expect(preview.locator('iframe')).toBeVisible();
    for (let i = 0; i < 12; i++) await page.keyboard.press('Tab');
    expect(await preview.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(preview).toBeHidden();
  });

  test('the layer list is a single tab stop', async ({ page }) => {
    const tree = page.getByRole('tree', { name: 'Layers' });
    await tree.focus();
    await page.keyboard.press('Tab');
    expect(await tree.evaluate((el) => el.contains(document.activeElement))).toBe(false);
    await page.keyboard.press('Shift+Tab');
    await expect(tree).toBeFocused();
  });
});
