import { expect, test } from '@playwright/test';
import { snapshot } from './helpers';

/** A first visit: the welcome screen, then a checklist that ticks itself off. */

test.use({ storageState: { cookies: [], origins: [] } });

test('a new visitor is welcomed, and the checklist follows what they do', async ({ page }) => {
  await page.goto('/#/editor');
  const welcome = page.getByRole('dialog', { name: 'Welcome to StyleCode' });
  await expect(welcome).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open the example project' })).toBeFocused();

  await page.getByRole('button', { name: 'Start with a blank canvas' }).click();
  await expect(welcome).toBeHidden();
  const checklist = page.getByRole('region', { name: 'Getting started' });
  await expect(checklist).toContainText('0 of 6');

  // Draw a frame: the first step ticks off.
  await page.keyboard.press('f');
  await page.mouse.move(300, 200);
  await page.mouse.down();
  await page.mouse.move(700, 500, { steps: 6 });
  await page.mouse.up();
  await expect(checklist).toContainText('1 of 6');
  await expect(checklist.getByText('Draw a frame (done)')).toBeAttached();

  // Opening the code ticks off another.
  await page.getByRole('tab', { name: 'Code' }).click();
  await expect(checklist).toContainText('2 of 6');

  // It stays dismissed after a reload, and the Help menu brings it back.
  await page.getByRole('button', { name: 'Hide getting started' }).click();
  await expect(checklist).toBeHidden();
  await page.reload();
  await page.waitForSelector('.canvas');
  await expect(welcome).toBeHidden();
  await expect(checklist).toBeHidden();
  await page.getByRole('button', { name: 'Help' }).click();
  await page.getByRole('menuitem', { name: 'Getting started' }).click();
  await expect(checklist).toContainText('2 of 6');
});

test('the welcome screen can open the example project', async ({ page }) => {
  await page.goto('/#/editor');
  await page.getByRole('button', { name: 'Open the example project' }).click();
  await expect.poll(async () => Object.keys((await snapshot(page)).doc.nodes).length).toBeGreaterThan(10);
  await expect(page.getByRole('region', { name: 'Getting started' })).toBeVisible();
});
