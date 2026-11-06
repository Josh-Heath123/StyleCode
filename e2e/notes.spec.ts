import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { E2E_WORKSPACE } from './workspaceFolder';

/**
 * Notes during a session (MVP story 5.1; Phase 1 brief, WP8). Every client and
 * person is role-played.
 */
const HEADERS = { 'x-stylecode-workspace': '1' };

interface StoredNote {
  text: string;
  writtenAt: string;
  updatedAt: string;
}
const onDisk = (id: string) =>
  JSON.parse(readFileSync(join(E2E_WORKSPACE, 'companies', id, 'workspace.json'), 'utf8')) as {
    notes: Record<string, StoredNote>;
    findings: Record<string, { evidence: unknown[]; history: unknown[] }>;
  };

/**
 * A client with a session that started `minutesAgo` minutes ago, and
 * optionally a note and a finding of the consultant's that quotes it.
 */
async function session(page: Page, options: { minutesAgo: number; quoted?: boolean; declined?: boolean }) {
  const res = await page.request.post('/api/workspace/companies', {
    headers: HEADERS,
    data: { profile: { name: `Harbour Bakery ${Math.random().toString(36).slice(2, 8)}` } },
  });
  const opened = (await res.json()) as { workspace: Record<string, unknown> & { company: { id: string } }; revision: string };
  const ws = opened.workspace;
  const id = ws.company.id;
  const at = new Date().toISOString();
  const startsAt = new Date(Date.now() - options.minutesAgo * 60_000).toISOString();
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
    se_1: { id: 'se_1', engagementId: 'en_1', title: 'Kick-off', startsAt, audioFileIds: [], createdAt: at, updatedAt: at },
  };
  ws.participants = {
    pa_alex: {
      id: 'pa_alex',
      sessionId: 'se_1',
      name: 'Alex Owner',
      role: 'Owner',
      organisation: '',
      side: 'client',
      speakerLabels: [],
    },
  };
  if (options.declined) {
    ws.consents = {
      cr_1: {
        id: 'cr_1',
        sessionId: 'se_1',
        askedParticipantIds: ['pa_alex'],
        askedBy: 'Sam Consultant',
        method: { kind: 'verbal-at-start' },
        wordingVersion: 'draft-1',
        told: {
          recorded: false,
          transcribed: false,
          aiExtraction: false,
          processingLocal: false,
          processingExternal: false,
          retention: false,
          canStopOrDelete: false,
          externalProvider: null,
        },
        given: { audioRecording: false, transcription: false, aiLocal: false, aiExternal: false, externalProvider: null },
        retention: { kind: 'until-engagement-ends' },
        outcome: { kind: 'declined' },
        confirmed: { by: 'Sam Consultant', at },
        attachmentFileId: null,
        lockedAt: null,
        amendments: [],
        createdAt: at,
        updatedAt: at,
      },
    };
  }
  if (options.quoted) {
    ws.notes = {
      no_1: {
        id: 'no_1',
        sessionId: 'se_1',
        text: 'Ask about spreadsheet conflicts at month end.',
        writtenAt: at,
        updatedAt: at,
      },
    };
    ws.findings = {
      fd_1: {
        id: 'fd_1',
        engagementId: 'en_1',
        kind: 'risk',
        statement: 'Month-end stock counts clash with the spreadsheet.',
        status: 'assumption',
        statusSet: { by: { kind: 'consultant', name: 'Sam Consultant' }, at },
        provenance: { kind: 'consultant' },
        evidence: [{ kind: 'note', noteId: 'no_1', quote: 'spreadsheet conflicts at month end' }],
        origin: { kind: 'consultant', by: 'Sam Consultant', at },
        history: [],
        createdAt: at,
        updatedAt: at,
      },
    };
  }
  const saved = await page.request.put(`/api/workspace/companies/${id}`, {
    headers: HEADERS,
    data: { workspace: ws, baseRevision: opened.revision },
  });
  expect(saved.status()).toBe(200);
  await page.request.put('/api/workspace/settings', { headers: HEADERS, data: { consultantName: 'Sam Consultant' } });
  await page.goto(`/#/c/${id}/e/en_1/s/se_1`);
  await expect(page.getByRole('heading', { level: 1, name: 'Kick-off' })).toBeVisible();
  return id;
}

const saved = (page: Page) => expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
const notes = (page: Page) => page.getByRole('list', { name: 'Notes' }).getByRole('listitem');

test('notes from the keyboard: N starts one, Ctrl+Enter adds it and starts the next, each with its time', async ({ page }) => {
  const id = await session(page, { minutesAgo: 12 });
  await expect(page.getByText(/No notes yet\. Press N/)).toBeVisible();
  await page.getByRole('heading', { level: 1 }).focus();
  await page.keyboard.press('n');
  const box = page.getByRole('textbox', { name: 'New note' });
  await expect(box).toBeFocused();
  await page.keyboard.type('Orders peak in December.');
  await page.keyboard.press('Control+Enter');
  await expect(notes(page)).toHaveCount(1);
  // The box stays open, empty, for the next note.
  await expect(page.getByRole('textbox', { name: 'New note' })).toBeFocused();
  await expect(page.getByRole('textbox', { name: 'New note' })).toHaveValue('');
  await page.keyboard.type('Stock is in a spreadsheet.');
  await page.keyboard.press('Control+Enter');
  await expect(notes(page)).toHaveCount(2);
  await expect(notes(page).nth(0)).toContainText('Orders peak in December.');
  await expect(notes(page).nth(0)).toContainText(/12 min in|13 min in/);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('textbox', { name: 'New note' })).toHaveCount(0);

  await saved(page);
  const stored = Object.values(onDisk(id).notes).sort((a, b) => a.writtenAt.localeCompare(b.writtenAt));
  expect(stored.map((n) => n.text)).toEqual(['Orders peak in December.', 'Stock is in a spreadsheet.']);
});

test('a note written before the session started says so', async ({ page }) => {
  await session(page, { minutesAgo: -30 });
  await page.getByRole('button', { name: /New note/ }).click();
  await page.keyboard.type('Read their website first.');
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(notes(page).first()).toContainText('before the start');
});

test('editing keeps the note’s time and says when it changed; deleting can be undone', async ({ page }) => {
  const id = await session(page, { minutesAgo: 5 });
  await page.keyboard.press('n');
  await page.keyboard.type('Delivery vans leave at six.');
  await page.keyboard.press('Control+Enter');
  await page.keyboard.press('Escape');
  await saved(page);
  const written = Object.values(onDisk(id).notes)[0].writtenAt;

  await page.getByRole('button', { name: /^Change the note written at/ }).click();
  const edit = page.getByRole('textbox', { name: 'Change the note' });
  await expect(edit).toBeFocused();
  await page.keyboard.type(' Sometimes at five.');
  await page.keyboard.press('Control+Enter');
  await expect(notes(page).first()).toContainText('Delivery vans leave at six. Sometimes at five.');
  await expect(notes(page).first()).toContainText(/^.*Changed/);
  await saved(page);
  const note = Object.values(onDisk(id).notes)[0];
  expect(note.writtenAt).toBe(written);
  expect(note.updatedAt).not.toBe(written);

  await page.getByRole('button', { name: /^Delete the note written at/ }).click();
  await expect(notes(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo Delete a note' }).click();
  await expect(notes(page)).toHaveCount(1);
});

test('notes work when consent was declined (C7)', async ({ page }) => {
  await session(page, { minutesAgo: 3, declined: true });
  await expect(page.getByRole('heading', { name: 'Consent: declined' })).toBeVisible();
  await page.keyboard.press('n');
  await page.keyboard.type('Client prefers no recording; notes only.');
  await page.keyboard.press('Control+Enter');
  await expect(notes(page)).toHaveCount(1);
});

test('changing a note a finding quotes lists the finding first, and one undo puts both back (decision 6)', async ({ page }) => {
  const id = await session(page, { minutesAgo: 20, quoted: true });
  await page.getByRole('button', { name: /^Delete the note written at/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete a quoted note' });
  await expect(dialog).toContainText('This finding quotes the note.');
  await expect(dialog).toContainText('Month-end stock counts clash with the spreadsheet.');
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(notes(page)).toHaveCount(1);

  await page.getByRole('button', { name: /^Delete the note written at/ }).click();
  await dialog.getByRole('button', { name: 'Delete the note' }).click();
  await expect(notes(page)).toHaveCount(0);
  await saved(page);
  expect(onDisk(id).findings.fd_1.evidence).toEqual([]);
  expect(onDisk(id).findings.fd_1.history).toHaveLength(1);

  await page.getByRole('button', { name: 'Undo Delete a note' }).click();
  await expect(notes(page)).toHaveCount(1);
  await saved(page);
  expect(onDisk(id).findings.fd_1.evidence).toHaveLength(1);
});
