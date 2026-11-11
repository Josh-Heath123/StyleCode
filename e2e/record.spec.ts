import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * The engagement's record (MVP stories 6.4, 7.1, 7.2; Phase 1 brief, WP9).
 * Every client and person is role-played.
 */
const HEADERS = { 'x-stylecode-workspace': '1' };

/** A client with one engagement, two sessions and a note in each; the record starts empty. */
async function engagementWithNotes(page: Page): Promise<string> {
  const res = await page.request.post('/api/workspace/companies', {
    headers: HEADERS,
    data: { profile: { name: `Harbour Bakery ${Math.random().toString(36).slice(2, 8)}` } },
  });
  const opened = (await res.json()) as { workspace: Record<string, unknown> & { company: { id: string } }; revision: string };
  const ws = opened.workspace;
  const id = ws.company.id;
  const at = '2026-11-04T09:00:00.000Z';
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
  const session = (sid: string, title: string, startsAt: string) => ({
    id: sid,
    engagementId: 'en_1',
    title,
    startsAt,
    timeZone: 'Africa/Johannesburg',
    audioFileIds: [],
    createdAt: at,
    updatedAt: at,
  });
  ws.sessions = { se_1: session('se_1', 'Kick-off', at), se_2: session('se_2', 'Follow-up', '2026-11-11T09:00:00.000Z') };
  ws.notes = {
    no_1: {
      id: 'no_1',
      sessionId: 'se_1',
      text: 'Orders peak in December, about five times the usual.',
      writtenAt: '2026-11-04T09:10:00.000Z',
      updatedAt: '2026-11-04T09:10:00.000Z',
    },
    no_2: {
      id: 'no_2',
      sessionId: 'se_2',
      text: 'They want deposits on wedding cakes.',
      writtenAt: '2026-11-11T09:20:00.000Z',
      updatedAt: '2026-11-11T09:20:00.000Z',
    },
  };
  // Kick-off has a confirmed consent record: told and agreed to transcription and AI on this computer.
  ws.participants = {
    pa_a: {
      id: 'pa_a',
      sessionId: 'se_1',
      name: 'Alex Owner',
      role: 'Owner',
      organisation: '',
      side: 'client',
      speakerLabels: [],
    },
  };
  ws.consents = {
    cr_1: {
      id: 'cr_1',
      sessionId: 'se_1',
      askedParticipantIds: ['pa_a'],
      askedBy: 'Sam Consultant',
      method: { kind: 'verbal-at-start' },
      wordingVersion: 'draft-1',
      told: {
        recorded: false,
        transcribed: true,
        aiExtraction: true,
        processingLocal: true,
        processingExternal: false,
        retention: false,
        canStopOrDelete: true,
        externalProvider: null,
      },
      given: { audioRecording: false, transcription: true, aiLocal: true, aiExternal: false, externalProvider: null },
      retention: { kind: 'until-engagement-ends' },
      outcome: { kind: 'given' },
      confirmed: { by: 'Sam Consultant', at },
      attachmentFileId: null,
      lockedAt: null,
      amendments: [],
      createdAt: at,
      updatedAt: at,
    },
  };
  const saved = await page.request.put(`/api/workspace/companies/${id}`, {
    headers: HEADERS,
    data: { workspace: ws, baseRevision: opened.revision },
  });
  expect(saved.status()).toBe(200);
  await page.request.put('/api/workspace/settings', { headers: HEADERS, data: { consultantName: 'Sam Consultant' } });
  return id;
}

const saved = (page: Page) => expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
/** A finding's card, found by its own statement (the same words also appear in other cards' links). */
const card = (page: Page, statement: string) =>
  page.locator('.ws-finding').filter({ has: page.locator('.ws-finding-statement').getByText(statement, { exact: true }) });

async function addFinding(page: Page, statement: string, kind: string, status: string, note?: string) {
  await page.getByRole('button', { name: 'Add finding' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add a finding' });
  await dialog.getByLabel('Statement').fill(statement);
  await dialog.getByLabel('Kind').selectOption({ label: kind });
  await dialog.getByLabel(status).check();
  if (note) await dialog.getByLabel(new RegExp(note)).check();
  await dialog.getByRole('button', { name: 'Add finding' }).click();
  await expect(dialog).toBeHidden();
}

test('findings added by hand, from the keyboard, land in their group with status and provenance as two labels', async ({
  page,
}) => {
  const id = await engagementWithNotes(page);
  await page.goto(`/#/c/${id}/e/en_1`);
  await page.getByRole('link', { name: 'Open the record' }).click();
  await expect(page.getByText(/No findings yet\. Findings are what you establish/)).toBeVisible();
  const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(scan.violations.map((v) => v.id)).toEqual([]);

  // From the keyboard alone.
  await page.getByRole('button', { name: 'Add finding' }).first().focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Add a finding' });
  await expect(dialog.getByLabel('Statement')).toBeFocused();
  await page.keyboard.type('Orders peak in December at about five times the usual volume.');
  await dialog.getByLabel('Kind').focus();
  await dialog.getByLabel('Kind').selectOption({ label: 'Scalability' });
  await dialog.getByLabel('Confirmed').focus();
  await page.keyboard.press('Space');
  await dialog.getByLabel(/Orders peak in December, about five times/).focus();
  await page.keyboard.press('Space');
  const quote = dialog.getByLabel(/The words quoted from the note/);
  await quote.fill('Orders peak in December');
  await dialog.getByRole('button', { name: 'Add finding' }).focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();

  const confirmed = page.getByRole('region', { name: /Confirmed/ });
  const peak = confirmed.getByRole('listitem').first();
  await expect(peak).toContainText('Orders peak in December at about five times the usual volume.');
  await expect(peak).toContainText('Scalability');
  await expect(peak.locator('.is-status')).toHaveText('Status: Confirmed');
  await expect(peak.locator('.is-provenance')).toHaveText('Provenance: Entered by the consultant');
  await expect(peak.getByRole('list', { name: 'Evidence' })).toContainText(
    /Orders peak in December note at \d\d:\d\d( [AP]M)?, in Kick-off/,
  );
  await expect(peak.getByRole('link', { name: 'Kick-off' })).toHaveAttribute('href', `#/c/${id}/e/en_1/s/se_1/p/no_1`);

  // A future consideration, suggested, lands in its own group; only groups with findings show.
  await addFinding(page, 'Stock across all three shops, next year.', 'Future consideration', 'Suggested (not agreed yet)');
  await expect(page.getByRole('region', { name: /Suggested/ })).toContainText('Future consideration');
  await expect(page.getByRole('region', { name: /Assumptions/ })).toHaveCount(0);
  await saved(page);
});

test('changing a finding records who and when, moves it between groups, and each change undoes', async ({ page }) => {
  const id = await engagementWithNotes(page);
  await page.goto(`/#/c/${id}/e/en_1/record`);
  await addFinding(
    page,
    'Deposits of half the price on wedding cakes.',
    'Business requirement',
    'Assumption',
    'deposits on wedding cakes',
  );
  await expect(page.getByRole('region', { name: /Assumptions/ })).toBeVisible();

  await page.getByRole('button', { name: 'Change “Deposits of half the price on wedding cakes.”' }).click();
  const dialog = page.getByRole('dialog', { name: 'Change the finding' });
  await dialog.getByLabel('Confirmed').check();
  await dialog.getByLabel('Statement').fill('Deposits of half the price on all celebration cakes.');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  const finding = card(page, 'Deposits of half the price on all celebration cakes.');
  await expect(page.getByRole('region', { name: /Confirmed/ })).toContainText(
    'Deposits of half the price on all celebration cakes.',
  );
  await finding.getByText('2 changes').click();
  await expect(finding).toContainText('Status: Assumption → Confirmed');
  await expect(finding).toContainText('(Sam Consultant,');

  await page.getByRole('button', { name: 'Undo Change a finding' }).click();
  await expect(page.getByRole('region', { name: /Assumptions/ })).toContainText('Deposits of half the price on wedding cakes.');
  await page.getByRole('button', { name: 'Undo Add a finding' }).click();
  await expect(page.getByText(/No findings yet/)).toBeVisible();
});

test('the record filters by kind and by session', async ({ page }) => {
  const id = await engagementWithNotes(page);
  await page.goto(`/#/c/${id}/e/en_1/record`);
  await addFinding(page, 'December peak.', 'Scalability', 'Confirmed', 'Orders peak in December');
  await addFinding(page, 'Deposits wanted.', 'Business requirement', 'Confirmed', 'deposits on wedding cakes');
  await addFinding(page, 'Who approves the budget?', 'Open question', 'Unresolved');
  await expect(page.getByText('3 findings')).toBeVisible();

  await page.getByLabel('Session').selectOption({ label: 'Follow-up' });
  await expect(page.getByText('1 of 3 findings')).toBeVisible();
  await expect(page.getByText('Deposits wanted.')).toBeVisible();
  await expect(page.getByText('December peak.')).toHaveCount(0);

  await page.getByLabel('Session').selectOption({ label: 'All sessions' });
  await page.getByLabel('Kind').selectOption({ label: 'Open question' });
  await expect(page.getByRole('region', { name: /Open/ })).toContainText('Who approves the budget?');
  await expect(page.getByText('1 of 3 findings')).toBeVisible();
  await page.getByLabel('Kind').selectOption({ label: 'Budget' });
  await expect(page.getByText('No findings match these filters.')).toBeVisible();
});

test('links: made within the engagement, shown from both ends, followed, and removed', async ({ page }) => {
  const id = await engagementWithNotes(page);
  await page.goto(`/#/c/${id}/e/en_1/record`);
  await addFinding(page, 'Traffic peaks in December.', 'Performance', 'Confirmed');
  await addFinding(page, 'The shop must handle five times the usual orders.', 'Scalability', 'Assumption');

  await page.getByRole('button', { name: 'Link “Traffic peaks in December.” to another finding' }).click();
  const dialog = page.getByRole('dialog', { name: 'Link to another finding' });
  await dialog.getByLabel('How it relates').selectOption({ label: 'Influences' });
  await dialog.getByLabel('The other finding').selectOption({ label: 'The shop must handle five times the usual orders.' });
  await dialog.getByRole('button', { name: 'Link' }).click();

  const peak = card(page, 'Traffic peaks in December.');
  const scale = card(page, 'The shop must handle five times the usual orders.');
  await expect(peak.getByRole('list', { name: 'Links' })).toContainText(
    'Influences: The shop must handle five times the usual orders.',
  );
  await expect(scale.getByRole('list', { name: 'Links' })).toContainText('Influenced by: Traffic peaks in December.');

  // Following a link moves focus to the other finding, from the keyboard.
  await scale.getByRole('button', { name: 'Traffic peaks in December.', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(peak).toBeFocused();

  // A finding the filters hide: following the link clears them, so it can be shown.
  await page.getByLabel('Kind').selectOption({ label: 'Performance' });
  await expect(scale).toHaveCount(0);
  await peak.getByRole('button', { name: 'The shop must handle five times the usual orders.', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Kind')).toHaveValue('');
  await expect(scale).toBeFocused();

  await peak.getByRole('button', { name: /Remove the link/ }).click();
  await expect(page.getByRole('list', { name: 'Links' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo Remove a link' }).click();
  await expect(page.getByRole('list', { name: 'Links' })).toHaveCount(2);
  await saved(page);
});

test('the record exports as Markdown with findings, links and consent, the same every time', async ({ page }) => {
  const id = await engagementWithNotes(page);
  await page.goto(`/#/c/${id}/e/en_1/record`);
  await addFinding(page, 'Traffic peaks in December.', 'Performance', 'Confirmed', 'Orders peak in December');
  await addFinding(page, 'The shop must cope with five times the usual orders.', 'Scalability', 'Assumption');
  await page.getByRole('button', { name: 'Link “Traffic peaks in December.” to another finding' }).click();
  await page.getByRole('dialog', { name: 'Link to another finding' }).getByRole('button', { name: 'Link' }).click();
  await saved(page);

  const exportOnce = async () => {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export as Markdown' }).click();
    const file = await download;
    return { name: file.suggestedFilename(), text: (await import('node:fs')).readFileSync(await file.path(), 'utf8') };
  };
  const first = await exportOnce();
  expect(first.name).toMatch(/^harbour-bakery-[a-z0-9]+-online-ordering\.md$/);
  expect(first.text).toContain('# Online ordering');
  expect(first.text).toContain('#### F1. Traffic peaks in December.');
  expect(first.text).toContain('- **Provenance:** Entered by the consultant');
  // Times are the session's own, with the offset (Phase 2 brief, decision 18).
  expect(first.text).toContain('### Kick-off\n\n2026-11-04 11:00 (GMT+2)\n');
  expect(first.text).toContain(
    '“Orders peak in December, about five times the usual.”, a note in Kick-off at 2026-11-04 11:10 (GMT+2)',
  );
  expect(first.text).toContain('F1 (Traffic peaks in December.) **influences** F2');
  expect(first.text).toContain('## Consent');
  // Which AI statement the client heard, in the words shown, and what the record allows.
  expect(first.text).toContain('- [x] “The AI runs on my computer only; nothing is sent elsewhere.”');
  expect(first.text).toContain('- **Allows now:** transcription, AI on this computer');
  expect(first.text).toContain('### Follow-up\n\nNo consent record.');
  expect((await exportOnce()).text).toBe(first.text);
});
