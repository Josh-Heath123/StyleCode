import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { kickoff } from './karoo';

/**
 * Times on screen (Phase 3 brief, decision 29): a session's pages show its
 * times in the session's own time zone, and add the offset as the export
 * writes it when that differs from the computer's. Karoo Freight's kick-off
 * is at 10:00 in Johannesburg (GMT+2), with a note at 10:10.
 */

test.describe('on a computer in another zone', () => {
  test.use({ timezoneId: 'Europe/London' });

  test('the session’s times are its own, with the offset', async ({ page }) => {
    const id = await kickoff(page, { note: 'Pieter wants offline dispatch.' });
    await expect(page.locator('.ws-lede')).toHaveText(/10:00(\s?AM)? \(GMT\+2\)$/);
    await expect(page.getByRole('button', { name: /^Change the note written at 10:10(\s?AM)? \(GMT\+2\)$/ })).toBeVisible();
    // The Starts field is on the session's clock too: it opens at 10:00, and a change is read there.
    const starts = page.getByLabel('Starts');
    await expect(starts).toHaveValue('2026-11-05T10:00');
    await starts.fill('2026-11-05T10:30');
    await starts.press('Enter');
    await expect
      .poll(async () => {
        const res = await page.request.get(`/api/workspace/companies/${id}`, { headers: { 'x-stylecode-workspace': '1' } });
        return ((await res.json()) as { workspace: { sessions: { se_1: { startsAt: string } } } }).workspace.sessions.se_1
          .startsAt;
      })
      .toBe('2026-11-05T08:30:00.000Z');
    const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(scan.violations.map((v) => v.id)).toEqual([]);
    // The engagement's list of sessions, and the consent record, too.
    await page.goto(`/#/c/${id}/e/en_1`);
    await expect(page.getByRole('link', { name: /Kick-off/ })).toContainText(/10:30(\s?AM)? \(GMT\+2\)/);
    await page.goto(`/#/c/${id}/e/en_1/s/se_1/consent`);
    await expect(page.locator('.ws-lede')).toHaveText(/10:30(\s?AM)? \(GMT\+2\)$/);
  });
});

test.describe('on a computer in the session’s zone', () => {
  test.use({ timezoneId: 'Africa/Johannesburg' });

  test('the times have no offset', async ({ page }) => {
    await kickoff(page, { note: 'Pieter wants offline dispatch.' });
    await expect(page.locator('.ws-lede')).toHaveText(/10:00(\s?AM)?$/);
    await expect(page.getByRole('button', { name: /^Change the note written at 10:10(\s?AM)?$/ })).toBeVisible();
  });
});
