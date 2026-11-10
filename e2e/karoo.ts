import { expect, type Page } from '@playwright/test';

/**
 * Karoo Freight's kick-off, as in docs/phase-2/samples/ (role-played): a
 * client with one engagement and one session, Sam Naidoo on the consultant's
 * side, Thandi and Pieter asked for consent, Lerato not. The consent record
 * allows transcription and local AI, and is confirmed unless `confirmed` is
 * false. With `note`, the session has that note, written at 10:10 there.
 * Opens the session page and returns the client's id.
 */
const HEADERS = { 'x-stylecode-workspace': '1' };

export async function kickoff(page: Page, options: { confirmed?: boolean; note?: string } = {}) {
  const res = await page.request.post('/api/workspace/companies', {
    headers: HEADERS,
    data: { profile: { name: `Karoo Freight ${Math.random().toString(36).slice(2, 8)}` } },
  });
  const opened = (await res.json()) as { workspace: Record<string, unknown> & { company: { id: string } }; revision: string };
  const ws = opened.workspace;
  const id = ws.company.id;
  const at = new Date().toISOString();
  ws.engagements = {
    en_1: {
      id: 'en_1',
      companyId: id,
      name: 'Dispatch app',
      goal: '',
      status: { state: 'active' },
      createdAt: at,
      updatedAt: at,
    },
  };
  ws.sessions = {
    se_1: {
      id: 'se_1',
      engagementId: 'en_1',
      title: 'Kick-off',
      startsAt: '2026-11-05T08:00:00.000Z',
      timeZone: 'Africa/Johannesburg',
      audioFileIds: [],
      createdAt: at,
      updatedAt: at,
    },
  };
  const person = (pid: string, name: string, side: 'client' | 'consultant') => ({
    id: pid,
    sessionId: 'se_1',
    name,
    role: '',
    organisation: side === 'client' ? 'Karoo Freight' : '',
    side,
    speakerLabels: [],
  });
  ws.participants = {
    pa_sam: person('pa_sam', 'Sam Naidoo', 'consultant'),
    pa_thandi: person('pa_thandi', 'Thandi Mokoena', 'client'),
    pa_pieter: person('pa_pieter', 'Pieter van Wyk', 'client'),
    pa_lerato: person('pa_lerato', 'Lerato Dlamini', 'client'),
  };
  ws.consents = {
    cr_1: {
      id: 'cr_1',
      sessionId: 'se_1',
      askedParticipantIds: ['pa_thandi', 'pa_pieter'],
      askedBy: 'Sam Naidoo',
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
      confirmed: options.confirmed === false ? null : { by: 'Sam Naidoo', at },
      attachmentFileId: null,
      lockedAt: null,
      amendments: [],
      createdAt: at,
      updatedAt: at,
    },
  };
  if (options.note)
    ws.notes = {
      no_1: { id: 'no_1', sessionId: 'se_1', text: options.note, writtenAt: '2026-11-05T08:10:00.000Z', updatedAt: at },
    };
  const saved = await page.request.put(`/api/workspace/companies/${id}`, {
    headers: HEADERS,
    data: { workspace: ws, baseRevision: opened.revision },
  });
  expect(saved.status()).toBe(200);
  // The same name as the other specs: settings are shared by tests running alongside.
  await page.request.put('/api/workspace/settings', { headers: HEADERS, data: { consultantName: 'Sam Consultant' } });
  await page.goto(`/#/c/${id}/e/en_1/s/se_1`);
  await expect(page.getByRole('heading', { level: 1, name: 'Kick-off' })).toBeVisible();
  return id;
}
