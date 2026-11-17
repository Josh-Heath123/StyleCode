import { expect, test } from '@playwright/test';
import { E2E_WORKSPACE } from './workspaceFolder';

/**
 * Settings (Phase 1 brief, WP5). The consultant's name is one setting for the
 * whole data folder, and most tests set it, so this runs after the others,
 * one at a time (`playwright.config.ts`, "after the rest"), and reads back
 * the name it saved rather than one another test saved meanwhile.
 */
const unique = (name: string) => `${name} ${Math.random().toString(36).slice(2, 8)}`;

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
