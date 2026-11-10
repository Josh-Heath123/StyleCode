import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { E2E_WORKSPACE } from './workspaceFolder';

/**
 * The consent form (MVP story 3.1; docs/spec/CONSENT.md; Phase 1 brief, WP7).
 * Every client and person is role-played.
 */
const HEADERS = { 'x-stylecode-workspace': '1' };
const unique = (name: string) => `${name} ${Math.random().toString(36).slice(2, 8)}`;

interface StoredConsent {
  confirmed: { by: string; at: string } | null;
  lockedAt: string | null;
  askedParticipantIds: string[];
  wordingVersion: string;
  told: Record<string, unknown>;
  given: {
    audioRecording: boolean;
    transcription: boolean;
    aiLocal: boolean;
    aiExternal: boolean;
    externalProvider: string | null;
  };
  outcome: { kind: string };
  amendments: { kind: string; reason: string }[];
}
const consentOnDisk = (id: string): StoredConsent[] =>
  Object.values(
    (
      JSON.parse(readFileSync(join(E2E_WORKSPACE, 'companies', id, 'workspace.json'), 'utf8')) as {
        consents: Record<string, StoredConsent>;
      }
    ).consents,
  );

/** A client with one engagement and one session, Alex on the client's side and Sam on the consultant's. */
async function sessionWithPeople(page: Page): Promise<{ id: string; href: string }> {
  const res = await page.request.post('/api/workspace/companies', {
    headers: HEADERS,
    data: { profile: { name: unique('Harbour Bakery') } },
  });
  const opened = (await res.json()) as {
    workspace: { company: { id: string; createdAt: string } } & Record<string, unknown>;
    revision: string;
  };
  const ws = opened.workspace;
  const id = ws.company.id;
  const at = ws.company.createdAt;
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
    se_1: {
      id: 'se_1',
      engagementId: 'en_1',
      title: 'Kick-off',
      startsAt: at,
      timeZone: 'Africa/Johannesburg',
      audioFileIds: [],
      createdAt: at,
      updatedAt: at,
    },
  };
  const person = (pid: string, name: string, role: string, side: string) => ({
    id: pid,
    sessionId: 'se_1',
    name,
    role,
    organisation: side === 'client' ? 'Harbour Bakery' : '',
    side,
    speakerLabels: [],
  });
  ws.participants = {
    pa_alex: person('pa_alex', 'Alex Owner', 'Owner', 'client'),
    pa_jo: person('pa_jo', 'Jo Baker', 'Head baker', 'client'),
    pa_sam: person('pa_sam', 'Sam Consultant', 'Consultant', 'consultant'),
  };
  const saved = await page.request.put(`/api/workspace/companies/${id}`, {
    headers: HEADERS,
    data: { workspace: ws, baseRevision: opened.revision },
  });
  expect(saved.status()).toBe(200);
  // The consultant's name is in settings, as after first use.
  await page.request.put('/api/workspace/settings', { headers: HEADERS, data: { consultantName: 'Sam Consultant' } });
  return { id, href: `/#/c/${id}/e/en_1/s/se_1` };
}

const saved = (page: Page) => expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();

/** Ticks or chooses a control from the keyboard: focus it, then Space. */
async function press(page: Page, control: ReturnType<Page['getByLabel']>) {
  await control.focus();
  await page.keyboard.press('Space');
}

test('the consent form from the keyboard alone: filled in, confirmed, edited, confirmed again and withdrawn', async ({
  page,
}) => {
  const { id, href } = await sessionWithPeople(page);
  await page.goto(href);
  await expect(page.getByRole('heading', { name: 'Consent: not filled in' })).toBeVisible();
  await page.getByRole('link', { name: 'Fill in consent form' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Consent for “Kick-off”' })).toBeVisible();

  await press(page, page.getByLabel(/^Alex Owner/));
  await press(page, page.getByLabel(/written transcript/));
  await press(page, page.getByLabel(/use AI to help/));
  await press(page, page.getByLabel(/runs on my computer only/));
  await press(page, page.getByLabel(/can ask me to stop/));
  await press(page, page.getByRole('group', { name: 'Transcription' }).getByLabel('Yes'));
  await press(page, page.getByRole('group', { name: 'AI on this computer' }).getByLabel('Yes'));
  const confirm = page.getByLabel('I asked for consent as recorded above.');
  await expect(confirm).toBeEnabled();
  await press(page, confirm);
  await page.getByRole('button', { name: 'Save and confirm' }).focus();
  await page.keyboard.press('Enter');

  await expect(page.getByRole('heading', { name: 'Consent: given · transcription, AI on this computer' })).toBeVisible();
  await saved(page);
  let [record] = consentOnDisk(id);
  expect(record).toMatchObject({ askedParticipantIds: ['pa_alex'], wordingVersion: 'draft-1', lockedAt: null });
  expect(record.confirmed?.by).toBe('Sam Consultant');

  // Editing clears the confirmation (C3) until it is confirmed again.
  await page.getByRole('link', { name: 'Edit consent form' }).click();
  await expect(page.getByLabel('I asked for consent as recorded above.')).toBeChecked();
  await press(page, page.getByRole('group', { name: 'AI on this computer' }).getByLabel('No'));
  await expect(page.getByLabel('I asked for consent as recorded above.')).not.toBeChecked();
  await expect(page.getByText('You changed the record, so it needs confirming again.')).toBeVisible();
  await page.getByRole('button', { name: 'Save as draft' }).click();
  await expect(page.getByRole('heading', { name: 'Consent: not confirmed' })).toBeVisible();
  await saved(page);
  expect(consentOnDisk(id)[0].confirmed).toBeNull();

  await page.getByRole('link', { name: 'Continue consent form' }).click();
  await press(page, page.getByLabel('I asked for consent as recorded above.'));
  await page.getByRole('button', { name: 'Save and confirm' }).click();
  await expect(page.getByRole('heading', { name: 'Consent: given · transcription' })).toBeVisible();

  // Withdrawal, with its reason, from the keyboard.
  await page.getByRole('button', { name: 'Withdraw consent…' }).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Withdraw consent' });
  await expect(dialog.getByLabel('Reason')).toBeFocused();
  await expect(dialog).toContainText('This can’t be undone, and the undo history is cleared.');
  await page.keyboard.type('Alex asked us to stop after the meeting.');
  await dialog.getByRole('button', { name: 'Record the withdrawal' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: /^Consent: withdrawn on/ })).toBeVisible();
  await expect(page.getByText('Reason: Alex asked us to stop after the meeting.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Withdraw consent…' })).toHaveCount(0);
  // A withdrawal is final (C4): undo can't bring the consent back.
  await expect(page.getByRole('button', { name: 'Nothing to undo' })).toBeDisabled();
  await saved(page);
  [record] = consentOnDisk(id);
  expect(record.lockedAt).not.toBeNull();
  expect(record.amendments).toMatchObject([{ kind: 'withdrawal', reason: 'Alex asked us to stop after the meeting.' }]);

  // A withdrawn record is shown, not edited.
  await page.getByRole('link', { name: 'View consent record' }).click();
  await expect(page.getByRole('heading', { name: 'The record' })).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByText(/Consent withdrawn by Sam Consultant/)).toBeVisible();
});

test('a "yes" the client wasn’t told about says so beside it, and the form can be saved as a draft but not confirmed (C2)', async ({
  page,
}) => {
  const { id, href } = await sessionWithPeople(page);
  await page.goto(`${href}/consent`);
  await page.getByLabel(/^Alex Owner/).check();
  // How long audio is kept is asked only once audio recording is agreed.
  await expect(page.getByRole('heading', { name: 'Audio kept' })).toHaveCount(0);
  await page.getByRole('group', { name: 'Audio recording' }).getByLabel('Yes').check();
  await expect(page.getByRole('heading', { name: 'Audio kept' })).toBeVisible();
  const audio = page.getByRole('group', { name: 'Audio recording' });
  await expect(audio).toContainText(
    'Tick what you told them: recording the audio, how long the recording is kept, stopping or deleting.',
  );
  await expect(page.getByLabel('I asked for consent as recorded above.')).toBeDisabled();

  await page.getByLabel(/record the audio of this meeting/).check();
  await page.getByLabel(/The recording is kept until the project ends/).check();
  await expect(audio).toContainText('Tick what you told them: stopping or deleting.');
  // Choosing how long the audio is kept changes the statement's words, so its tick is cleared:
  // the consultant ticks the words they actually said.
  await page.getByLabel('For a number of days').check();
  await page.getByLabel('Days the audio is kept').fill('14');
  const retention = page.getByLabel(/The recording is kept for 14 days/);
  await expect(retention).not.toBeChecked();
  await expect(page.getByText(/now says something else, so it is unticked/)).toBeVisible();
  await expect(audio).toContainText('how long the recording is kept');
  await retention.check();
  await expect(page.getByText(/now says something else, so it is unticked/)).toHaveCount(0);

  await page.getByRole('button', { name: 'Save as draft' }).click();
  await expect(page.getByRole('heading', { name: 'Consent: not confirmed' })).toBeVisible();
  await saved(page);
  expect(consentOnDisk(id)[0]).toMatchObject({ confirmed: null, given: { audioRecording: true } });
});

test('declined consent sets every answer to no, and the session can only have notes (C7)', async ({ page }) => {
  const { id, href } = await sessionWithPeople(page);
  await page.goto(`${href}/consent`);
  await page.getByLabel(/^Jo Baker/).check();
  await page.getByRole('group', { name: 'Transcription' }).getByLabel('Yes').check();
  await page.getByLabel('Declined').check();
  await expect(page.getByRole('group', { name: 'Transcription' }).getByLabel('No')).toBeChecked();
  await expect(page.getByRole('group', { name: 'Transcription' }).getByLabel('Yes')).toBeDisabled();
  await page.getByLabel('I asked for consent as recorded above.').check();
  await page.getByRole('button', { name: 'Save and confirm' }).click();
  await expect(page.getByRole('heading', { name: 'Consent: declined' })).toBeVisible();
  await expect(page.getByText('This session can only have notes, and the AI won’t process them.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Withdraw consent…' })).toHaveCount(0);
  await saved(page);
  expect(consentOnDisk(id)[0]).toMatchObject({ outcome: { kind: 'declined' }, given: { transcription: false } });
});

test('with an external AI provider set up, the form names it in the statement and the answer (C6)', async ({ page }) => {
  await page.route('**/api/ai/config', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({
          json: {
            provider: 'anthropic',
            configPath: '',
            providers: {
              ollama: { baseUrl: 'http://localhost:11434', model: '', hasKey: false, keySource: null },
              openai: { baseUrl: 'https://api.openai.com/v1', model: '', hasKey: false, keySource: null },
              anthropic: { baseUrl: 'https://api.anthropic.com', model: 'claude', hasKey: true, keySource: 'file' },
            },
          },
        })
      : route.fallback(),
  );
  const { id, href } = await sessionWithPeople(page);
  await page.goto(`${href}/consent`);
  const provider = 'Anthropic (api.anthropic.com)';
  await page.getByLabel(/^Alex Owner/).check();
  await page.getByLabel(/use AI to help/).check();
  await page.getByLabel(new RegExp(`may be sent to ${provider.replace(/[()]/g, '\\$&')}`)).check();
  await page.getByLabel(/can ask me to stop/).check();
  await page
    .getByRole('group', { name: `AI by ${provider}` })
    .getByLabel('Yes')
    .check();
  await page.getByLabel('I asked for consent as recorded above.').check();
  await page.getByRole('button', { name: 'Save and confirm' }).click();
  await expect(page.getByRole('heading', { name: `Consent: given · AI by ${provider}` })).toBeVisible();
  await saved(page);
  expect(consentOnDisk(id)[0]).toMatchObject({
    told: { processingExternal: true, externalProvider: provider },
    given: { aiExternal: true, externalProvider: provider },
  });
});

test('consent given to nothing can’t be confirmed', async ({ page }) => {
  const { href } = await sessionWithPeople(page);
  await page.goto(`${href}/consent`);
  await page.getByLabel(/^Alex Owner/).check();
  await expect(page.getByRole('group', { name: 'What they agreed to' })).toContainText(
    'Nothing is agreed: choose Declined, or set what they agreed to.',
  );
  await expect(page.getByLabel('I asked for consent as recorded above.')).toBeDisabled();
  await page.getByLabel('Declined').check();
  await expect(page.getByLabel('I asked for consent as recorded above.')).toBeEnabled();
});

test('someone named on the consent form as asked can’t be removed from the session', async ({ page }) => {
  const { href } = await sessionWithPeople(page);
  await page.goto(`${href}/consent`);
  await page.getByLabel(/^Alex Owner/).check();
  await page.getByRole('button', { name: 'Save as draft' }).click();
  await expect(page.getByRole('heading', { name: 'Consent: not confirmed' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove Alex Owner' }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'Alex Owner is named on the consent form as asked. To remove them, untick them under “Who was asked” on the consent form first.',
  );
  await expect(page.getByRole('list', { name: 'Participants' }).getByRole('listitem')).toHaveCount(3);
});

test('changing who was asked, or when, warns first and clears the confirmation (C3)', async ({ page }) => {
  const { id, href } = await sessionWithPeople(page);
  await page.goto(`${href}/consent`);
  await page.getByLabel(/^Alex Owner/).check();
  await page.getByLabel(/written transcript/).check();
  await page.getByLabel(/can ask me to stop/).check();
  await page.getByRole('group', { name: 'Transcription' }).getByLabel('Yes').check();
  await page.getByLabel('I asked for consent as recorded above.').check();
  await page.getByRole('button', { name: 'Save and confirm' }).click();
  await expect(page.getByRole('heading', { name: 'Consent: given · transcription' })).toBeVisible();

  // Changing someone not asked says nothing.
  await page.getByRole('button', { name: 'Edit Jo Baker' }).click();
  const jo = page.getByRole('dialog', { name: 'Edit Jo Baker' });
  await jo.getByLabel(/Role/).fill('Manager');
  await expect(jo.getByText(/named on the confirmed consent form/)).toHaveCount(0);
  await jo.getByRole('button', { name: 'Cancel' }).click();

  // Changing Alex warns before the change, then clears the confirmation.
  await page.getByRole('button', { name: 'Edit Alex Owner' }).click();
  const alex = page.getByRole('dialog', { name: 'Edit Alex Owner' });
  await alex.getByLabel(/Role/).fill('Founder');
  await expect(alex).toContainText(
    'Alex Owner is named on the confirmed consent form. Changing this clears the confirmation, so confirm the form again afterwards.',
  );
  await alex.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('heading', { name: 'Consent: not confirmed' })).toBeVisible();
  await saved(page);
  expect(consentOnDisk(id)[0].confirmed).toBeNull();

  // Confirmed again, the session's time warns under its field, and changing it clears the confirmation too.
  await page.getByRole('link', { name: 'Continue consent form' }).click();
  await page.getByLabel('I asked for consent as recorded above.').check();
  await page.getByRole('button', { name: 'Save and confirm' }).click();
  const starts = page.getByLabel('Starts');
  await expect(starts).toHaveAccessibleDescription(/Changing its date or time clears the confirmation/);
  await starts.fill('2026-11-04T10:30');
  await starts.blur();
  await expect(page.getByRole('heading', { name: 'Consent: not confirmed' })).toBeVisible();
});
