import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { FAKE_MODEL, startFakeOllama, type FakeOllama } from './fakeOllama';
import { kickoff } from './karoo';
import { E2E_WORKSPACE } from './workspaceFolder';

/**
 * Asking the AI for findings from a session and reviewing them (MVP 6.1–6.3;
 * Phase 2 brief, WP6 and WP7), through the real local AI server to a fake
 * Ollama that answers predictably. The AI settings are served to the page by the test, and each
 * request names its provider and model, so these tests don't touch the AI
 * settings file other tests share. Karoo Freight is role-played.
 */

let fake: FakeOllama;
test.beforeAll(async () => {
  fake = await startFakeOllama();
});
test.afterAll(async () => {
  await fake.close();
});

const SAMPLES = join(import.meta.dirname, '..', 'docs', 'phase-2', 'samples', 'karoo-freight-kickoff');

interface Stored {
  findings: Record<
    string,
    {
      status: string;
      statement: string;
      history?: unknown[];
      provenance: { kind: string };
      evidence: { kind: string; quote: string }[];
      origin: { kind: string; model: string; processing: { kind: string }; inputSessionIds: string[]; review: { state: string } };
    }
  >;
}
const onDisk = (id: string) => JSON.parse(readFileSync(join(E2E_WORKSPACE, 'companies', id, 'workspace.json'), 'utf8')) as Stored;

const card = (page: Page) =>
  page.locator('section').filter({ has: page.getByRole('heading', { name: 'Findings from the AI', exact: true }) });

/** Serves AI settings to the page: AI off, or Ollama at the fake with this model. `setup.model` can change during a test. */
async function aiSettings(page: Page, setup: { provider: 'off' | 'ollama'; model: string; contextSize?: number }) {
  await page.route('**/api/ai/config', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({
          json: {
            provider: setup.provider,
            configPath: '',
            providers: {
              ollama: {
                baseUrl: fake.url,
                model: setup.model,
                contextSize: setup.contextSize ?? 8192,
                hasKey: false,
                keySource: null,
              },
              openai: { baseUrl: 'https://api.openai.com/v1', model: '', hasKey: false, keySource: null },
              anthropic: { baseUrl: 'https://api.anthropic.com', model: '', hasKey: false, keySource: null },
            },
          },
        })
      : route.continue(),
  );
}

/** Imports the Teams sample, so the session has a transcript with its speakers matched by name. */
async function importTranscript(page: Page) {
  await page.getByRole('button', { name: 'Import transcript…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import a transcript' });
  await dialog.getByLabel('File (.vtt, .docx or .txt)').setInputFiles(join(SAMPLES, 'teams-transcript.vtt'));
  await dialog.getByRole('button', { name: 'Import transcript' }).click();
  await expect(dialog).toHaveCount(0);
}

const requestsFor = (model: string) => fake.requests.filter((r) => r.model === model).length;

test('with AI off, or nothing to read, the session says why and offers nothing (MVP 6.1)', async ({ page }) => {
  const setup = { provider: 'off' as const, model: '' };
  await aiSettings(page, setup);
  await kickoff(page);
  await expect(card(page)).toContainText('Import a transcript or write notes first: the AI proposes findings from them.');
  await importTranscript(page);
  await expect(card(page)).toContainText('AI is turned off. Turn it on in AI settings, in the design editor’s top bar.');
  await expect(page.getByRole('button', { name: 'Ask the AI for findings' })).toHaveCount(0);
});

test('an Ollama cloud model isn’t offered when the client agreed only to AI on this computer (C6)', async ({ page }) => {
  await aiSettings(page, { provider: 'ollama', model: 'gpt-oss:120b-cloud' });
  await kickoff(page, { note: 'Thandi wants the pilot in Bloemfontein first.' });
  await expect(card(page)).toContainText(
    'The AI isn’t offered for this session. The client did not agree to an external AI provider. Use a model on this computer.',
  );
  await expect(page.getByRole('button', { name: 'Ask the AI for findings' })).toHaveCount(0);
});

const proposals = (page: Page) =>
  card(page)
    .getByRole('list', { name: /waiting for review/ })
    .locator('> li');
const findings = (id: string) => Object.values(onDisk(id).findings);
const byState = (id: string, state: string) => findings(id).filter((f) => f.origin.review.state === state);

test('asking for findings: the proposals wait for review, what failed the checks is counted, and undo removes them', async ({
  page,
}) => {
  await aiSettings(page, { provider: 'ollama', model: FAKE_MODEL });
  const id = await kickoff(page);
  await importTranscript(page);
  await expect(card(page)).toContainText(
    `The AI reads this session’s transcript and notes, and nothing else, using ${FAKE_MODEL}, on this computer.`,
  );
  await expect(card(page)).toContainText('It usually finds about two thirds of what a careful consultant would record');
  await expect(card(page).getByTestId('run-estimate')).toHaveText(
    `No estimate yet: ${FAKE_MODEL} hasn’t read a whole session on this computer before. A local model can take several minutes for a long meeting, and you can keep working meanwhile.`,
  );
  await page.getByRole('button', { name: 'Ask the AI for findings' }).click();
  await expect(card(page).getByRole('status').first()).toContainText(/The AI proposed \d+ findings to review\./);
  await expect(card(page)).toContainText(
    'Not shown, because they failed StyleCode’s checks: 1 quoted words that aren’t in the passage.',
  );
  await expect(card(page).getByRole('heading', { name: /^\d+ proposals waiting for review$/ })).toBeVisible();
  // Each is marked as the AI's, its quote shown first.
  await expect(proposals(page).first()).toContainText('Proposed by the AI');
  await expect(proposals(page).first().getByRole('list', { name: 'What it quotes' })).toContainText(/said by Thandi Mokoena/);

  // Sent once, to the model that was checked, with thinking off.
  const sent = fake.requests.at(-1)!;
  expect(sent.model).toBe(FAKE_MODEL);
  expect((sent as unknown as { think: boolean }).think).toBe(false);
  expect(sent.messages[1].content).toContain('Thandi Mokoena (client): ');

  await expect.poll(() => findings(id).length).toBeGreaterThan(0);
  for (const f of findings(id)) {
    expect(f.origin).toMatchObject({
      kind: 'ai',
      model: FAKE_MODEL,
      processing: { kind: 'local' },
      inputSessionIds: ['se_1'],
      review: { state: 'pending' },
    });
    expect(f.provenance.kind).toBe('said-in-session');
    expect(f.status).toBe('suggested');
  }

  // Now there is an estimate, and asking again proposes nothing new: every proposal repeats one under review.
  await card(page).getByRole('button', { name: 'Close this summary' }).click();
  await expect(card(page).getByTestId('run-estimate')).toContainText(
    `This will take less than a minute, judging by ${FAKE_MODEL}’s earlier runs on this computer.`,
  );
  await page.getByRole('button', { name: 'Ask the AI for findings' }).click();
  await expect(card(page)).toContainText('The AI proposed nothing new.');
  // Repeats aren't failures: they are left out, and said so apart from what failed the checks.
  await expect(card(page)).toContainText(/Left out: \d+ repeated a finding already in this engagement, or one proposed before\./);
  await expect(card(page)).toContainText(
    'Not shown, because they failed StyleCode’s checks: 1 quoted words that aren’t in the passage.',
  );

  await page.keyboard.press('Control+z');
  await expect(card(page)).not.toContainText('waiting for review');
  await expect.poll(() => findings(id).length).toBe(0);
});

test('reviewing from the keyboard: select, accept with a status, edit and accept, reject, undo; the report counts them', async ({
  page,
}) => {
  await aiSettings(page, { provider: 'ollama', model: FAKE_MODEL });
  const id = await kickoff(page);
  await importTranscript(page);
  await page.getByRole('button', { name: 'Ask the AI for findings' }).click();
  await expect(card(page).getByRole('heading', { name: /proposals waiting for review/ })).toBeVisible();
  const total = await proposals(page).count();
  expect(total).toBeGreaterThan(3);

  // Into the list: the first proposal is selected, and the words it quotes are marked in the transcript.
  const first = proposals(page).first();
  await first.focus();
  await expect(first).toHaveAttribute('aria-current', 'true');
  const quote = (await first.getByRole('list', { name: 'What it quotes' }).locator('q').first().textContent())!;
  await expect(page.locator('.ws-segment.is-quoted mark').first()).toHaveText(quote);
  // Only the selected proposal offers its actions; the others show the quote, statement and labels.
  await expect(first.getByRole('button', { name: 'Accept' })).toBeVisible();
  await expect(proposals(page).nth(1).getByRole('button')).toHaveCount(0);
  await expect(proposals(page).nth(1)).toContainText('Proposed by the AI');

  // ↓ moves to the next; A accepts it with the status chosen, and the one after takes its place.
  await page.keyboard.press('ArrowDown');
  const second = proposals(page).nth(1);
  await expect(second).toHaveAttribute('aria-current', 'true');
  await expect(second).toBeFocused();
  await second.getByRole('combobox').selectOption('confirmed');
  await second.focus();
  await page.keyboard.press('a');
  await expect(proposals(page)).toHaveCount(total - 1);
  await expect(proposals(page).nth(1)).toBeFocused();
  await expect.poll(() => byState(id, 'accepted').map((f) => f.status)).toEqual(['confirmed']);

  // R rejects: kept, hidden, with who.
  await page.keyboard.press('r');
  await expect(proposals(page)).toHaveCount(total - 2);
  await expect.poll(() => byState(id, 'rejected').length).toBe(1);

  // E edits, then accepts with the changes, each in the history.
  await page.keyboard.press('e');
  const dialog = page.getByRole('dialog', { name: 'Edit the proposal, then accept it' });
  await expect(dialog).toContainText('The AI proposed “Suggested (not agreed yet)”. Only you can confirm a finding.');
  await dialog.getByLabel('Statement').fill('Dispatch runs on a WhatsApp group today.');
  await dialog.getByLabel('Kind').selectOption({ label: 'Existing system' });
  await dialog.getByRole('button', { name: 'Accept with these changes' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(proposals(page)).toHaveCount(total - 3);
  await expect
    .poll(() => byState(id, 'accepted').find((f) => f.statement === 'Dispatch runs on a WhatsApp group today.')?.history?.length)
    .toBe(2);

  // The report: one accepted, one edited, one rejected, the rest waiting.
  await card(page).getByText('How the AI did on this session').click();
  await expect(card(page).getByRole('row', { name: /^All/ }).getByRole('cell')).toHaveText([
    String(total),
    '1',
    '1',
    '1',
    String(total - 3),
  ]);

  // Undo takes back the edit-and-accept: the proposal waits again.
  await page.keyboard.press('Control+z');
  await expect(proposals(page)).toHaveCount(total - 2);
});

test('Stop partway keeps what the parts that finished proposed, says which, and they can be discarded', async ({ page }) => {
  // A small context, so the meeting is read in several parts; the second is slow.
  await aiSettings(page, { provider: 'ollama', model: FAKE_MODEL, contextSize: 2048 });
  const id = await kickoff(page, { title: 'Slow from part two' });
  await importTranscript(page);
  await page.getByRole('button', { name: 'Ask the AI for findings' }).click();
  await expect(card(page).getByRole('status')).toContainText(/The AI is reading part 2 of \d+\./);
  await card(page).getByRole('button', { name: 'Stop' }).click();
  await expect(card(page).getByRole('status').first()).toContainText(/Stopped after part 1 of \d+\./);
  const coverage =
    /\d+ proposals from part 1 of \d+ are waiting for review\. The rest of the session wasn’t read: ask the AI again to read all of it\./;
  await expect(card(page)).toContainText(coverage);
  await expect.poll(() => findings(id).length).toBeGreaterThan(0);

  // After a reload, what that run read is still said, until its proposals are reviewed or discarded.
  await page.reload();
  await expect(card(page)).toContainText(coverage);
  await expect(card(page)).not.toContainText('Stopped after');

  await card(page)
    .getByRole('button', { name: /^Discard these \d+ proposals$/ })
    .click();
  await expect(card(page)).toContainText(/The proposals from part 1 of \d+ were discarded\. Undo brings them back\./);
  await expect.poll(() => findings(id).length).toBe(0);
  await page.keyboard.press('Control+z');
  await expect.poll(() => findings(id).length).toBeGreaterThan(0);
  await expect(card(page)).toContainText(coverage);

  // Reviewing them all ends it: reject each, from the keyboard.
  await proposals(page).first().focus();
  const left = await proposals(page).count();
  for (let i = 0; i < left; i++) {
    await page.keyboard.press('r');
    await expect(proposals(page)).toHaveCount(left - i - 1);
  }
  await expect(card(page)).not.toContainText(/from part 1 of/);
});

test('a quote from the consultant’s side says so', async ({ page }) => {
  await aiSettings(page, { provider: 'ollama', model: FAKE_MODEL });
  await kickoff(page, { title: 'Kick-off, both sides' });
  await importTranscript(page);
  await page.getByRole('button', { name: 'Ask the AI for findings' }).click();
  await expect(card(page).getByRole('heading', { name: /proposals waiting for review/ })).toBeVisible();
  await expect(card(page).getByRole('list', { name: 'What it quotes' }).filter({ hasText: 'Sam Naidoo' }).first()).toContainText(
    'said by Sam Naidoo (your side)',
  );
  await expect(card(page).getByRole('list', { name: 'What it quotes' }).filter({ hasText: 'Thandi' }).first()).toContainText(
    /said by Thandi Mokoena$/,
  );
});

test('Stop before any part finishes adds nothing', async ({ page }) => {
  await aiSettings(page, { provider: 'ollama', model: FAKE_MODEL });
  const id = await kickoff(page, { title: 'A slow kick-off' });
  await importTranscript(page);
  await page.getByRole('button', { name: 'Ask the AI for findings' }).click();
  await expect(card(page).getByRole('status')).toContainText('The AI is reading the session.');
  await card(page).getByRole('button', { name: 'Stop' }).click();
  await expect(card(page)).toContainText('Nothing was added: no part had finished.');
  expect(findings(id)).toHaveLength(0);
  await expect(page.getByRole('button', { name: 'Ask the AI again' })).toBeVisible();
});

test('when the model fails partway, the session says so and keeps what came before', async ({ page }) => {
  await aiSettings(page, { provider: 'ollama', model: FAKE_MODEL, contextSize: 2048 });
  const id = await kickoff(page, { title: 'Fails on part two' });
  await importTranscript(page);
  await page.getByRole('button', { name: 'Ask the AI for findings' }).click();
  await expect(card(page)).toContainText(
    /The AI stopped working on part 2 of \d+\.\s?Ollama returned an error \(500\): model runner has unexpectedly stopped/,
  );
  await expect(card(page)).toContainText(/proposals from part 1 of \d+ are waiting for review/);
  await expect.poll(() => findings(id).length).toBeGreaterThan(0);
});

test('when the model fails on the only part, nothing is added', async ({ page }) => {
  await aiSettings(page, { provider: 'ollama', model: FAKE_MODEL });
  const id = await kickoff(page, { title: 'A kick-off that will fail' });
  await importTranscript(page);
  await page.getByRole('button', { name: 'Ask the AI for findings' }).click();
  await expect(card(page)).toContainText('Ollama returned an error (500): model runner has unexpectedly stopped');
  await expect(card(page)).toContainText('Nothing was added: no part had finished.');
  expect(findings(id)).toHaveLength(0);
});

test('switching to a cloud model during a run stops it before anything is sent there (C5, C6)', async ({ page }) => {
  // A small context, so the meeting is sent in several parts.
  const setup = { provider: 'ollama' as const, model: FAKE_MODEL, contextSize: 2048 };
  await aiSettings(page, setup);
  const id = await kickoff(page);
  await importTranscript(page);
  const before = requestsFor(FAKE_MODEL);
  // The settings change to a cloud model while the first part is with the AI.
  await page.route('**/api/ai/chat', async (route) => {
    setup.model = 'gpt-oss:120b-cloud';
    await route.continue();
  });
  await page.getByRole('button', { name: 'Ask the AI for findings' }).click();
  await expect(card(page)).toContainText('The AI settings changed while the AI was working, so it stopped.');
  expect(requestsFor(FAKE_MODEL) - before).toBe(1);
  expect(requestsFor('gpt-oss:120b-cloud')).toBe(0);
  // What the local model proposed for the first part is kept: consent allowed that.
  await expect(card(page)).toContainText(/proposals from part 1 of \d+ are waiting for review/);
  for (const f of findings(id)) expect(f.origin).toMatchObject({ model: FAKE_MODEL, processing: { kind: 'local' } });
  // Back on the page, the cloud model isn't offered.
  await expect(card(page)).toContainText('The client did not agree to an external AI provider.');
});

test('a run goes on while the consultant works elsewhere, and closing the tab asks first', async ({ page }) => {
  await aiSettings(page, { provider: 'ollama', model: FAKE_MODEL, contextSize: 2048 });
  const id = await kickoff(page, { title: 'A steady kick-off' });
  await importTranscript(page);
  await page.getByRole('button', { name: 'Ask the AI for findings' }).click();
  const nav = page.getByRole('navigation', { name: 'StyleCode' });
  await expect(nav.getByRole('link', { name: /The AI is reading “A steady kick-off”: part \d+ of \d+/ })).toBeVisible();

  // Closing the tab during a run asks first.
  let asked = false;
  page.once('dialog', async (d) => {
    asked = d.type() === 'beforeunload';
    await d.dismiss();
  });
  await page.close({ runBeforeUnload: true });
  await expect.poll(() => asked).toBe(true);
  expect(page.isClosed()).toBe(false);

  // Off to the design editor, and to the clients list, while it reads.
  await nav.getByRole('link', { name: 'Design editor' }).click();
  await expect(
    page.getByRole('navigation', { name: 'StyleCode' }).getByRole('link', { name: /The AI is reading/ }),
  ).toBeVisible();
  await page.evaluate(() => (location.hash = '#/'));
  const done = page.getByRole('navigation', { name: 'StyleCode' }).getByRole('link', {
    name: 'The AI has finished “A steady kick-off”',
  });
  await expect(done).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => findings(id).length).toBeGreaterThan(0);
  await done.click();
  await expect(card(page).getByRole('heading', { name: /proposals waiting for review/ })).toBeVisible();
  await expect(card(page)).toContainText(/The AI proposed \d+ findings to review\./);
});

test('a note quoted by a proposal under review can’t change, and the message leads to the proposal (decision 14)', async ({
  page,
}) => {
  await aiSettings(page, { provider: 'ollama', model: FAKE_MODEL });
  await kickoff(page, { note: 'Thandi wants the pilot in Bloemfontein first.' });
  await page.getByRole('button', { name: 'Ask the AI for findings' }).click();
  await expect(card(page).getByRole('heading', { name: '1 proposal waiting for review' })).toBeVisible();
  const notes = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Notes', exact: true }) });
  await notes.getByRole('button', { name: /Change the note written at/ }).click();
  await notes.getByRole('textbox').fill('The pilot is in Midrand first.');
  await notes.getByRole('button', { name: 'Save' }).click();
  await expect(notes.getByRole('alert')).toContainText('An AI proposal quotes this note (“The note said: Thandi wants the pilot');
  await notes.getByRole('button', { name: 'Review the proposal' }).click();
  await expect(proposals(page).first()).toBeFocused();
  await expect(proposals(page).first()).toHaveAttribute('aria-current', 'true');
  // The note is marked as what the proposal quotes; its editor stays open, so the change typed isn't lost.
  await expect(page.locator('.ws-note.is-quoted')).toHaveCount(1);
  await expect(notes.getByRole('textbox')).toHaveValue('The pilot is in Midrand first.');
});

test('? lists the review shortcuts on a client page', async ({ page }) => {
  await aiSettings(page, { provider: 'off', model: '' });
  await kickoff(page);
  await page.keyboard.press('?');
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(dialog.getByRole('region', { name: 'Reviewing the AI’s proposals' })).toContainText('Reject the proposal');
  await expect(dialog).not.toContainText('Rectangle');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('the card passes the accessibility checks: before a run, during one, and reviewing', async ({ page }) => {
  await aiSettings(page, { provider: 'ollama', model: FAKE_MODEL, contextSize: 2048 });
  await kickoff(page, { title: 'Slow from part two' });
  await importTranscript(page);
  const check = async () =>
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations).toEqual(
      [],
    );
  await check();
  await page.getByRole('button', { name: 'Ask the AI for findings' }).focus();
  await page.keyboard.press('Enter');
  await expect(card(page).getByRole('status')).toContainText(/part 2 of/);
  await check();
  await card(page).getByRole('button', { name: 'Stop' }).click();
  await expect(card(page).getByRole('heading', { name: /proposals waiting for review/ })).toBeVisible();
  await proposals(page).first().focus();
  await check();
  await page.keyboard.press('e');
  await expect(page.getByRole('dialog', { name: 'Edit the proposal, then accept it' })).toBeVisible();
  await check();
});

test('a run goes on while another client is open, and its proposals reach its own client', async ({ page }) => {
  await aiSettings(page, { provider: 'ollama', model: FAKE_MODEL, contextSize: 2048 });
  const first = await kickoff(page, { title: 'A steady kick-off' });
  await importTranscript(page);
  await page.getByRole('button', { name: 'Ask the AI for findings' }).click();
  await expect(card(page).getByRole('status')).toContainText(/The AI is reading part/);
  // Another client opened meanwhile: the first stays open until its run has saved.
  const second = await kickoff(page);
  const nav = page.getByRole('navigation', { name: 'StyleCode' });
  await expect(nav.getByRole('link', { name: 'The AI has finished “A steady kick-off”' })).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => findings(first).length).toBeGreaterThan(0);
  expect(findings(second)).toHaveLength(0);
});

test('withdrawing consent during a run stops it at once, and nothing is added (C5)', async ({ page }) => {
  await aiSettings(page, { provider: 'ollama', model: FAKE_MODEL, contextSize: 2048 });
  const id = await kickoff(page, { title: 'Slow from part two' });
  await importTranscript(page);
  const before = requestsFor(FAKE_MODEL);
  await page.getByRole('button', { name: 'Ask the AI for findings' }).click();
  await expect(card(page).getByRole('status')).toContainText(/The AI is reading part 2 of/);
  // Part 2's request has reached the model before anything is counted.
  await expect.poll(() => requestsFor(FAKE_MODEL)).toBe(before + 2);
  const sent = before + 2;
  await page.getByRole('button', { name: 'Withdraw consent…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Withdraw consent' });
  await dialog.getByLabel('Reason').fill('Thandi asked us to stop.');
  await dialog.getByRole('button', { name: 'Record the withdrawal' }).click();
  await expect(card(page)).toContainText('The client withdrew consent for this session. The AI stopped.');
  await expect(card(page)).toContainText('The proposals couldn’t be added: The client withdrew consent for this session.');
  expect(requestsFor(FAKE_MODEL)).toBe(sent);
  expect(findings(id)).toHaveLength(0);
});

test('deleting the client during a run stops it, and nothing more is sent', async ({ page }) => {
  await aiSettings(page, { provider: 'ollama', model: FAKE_MODEL, contextSize: 2048 });
  const id = await kickoff(page, { title: 'Slow from part two' });
  await importTranscript(page);
  const before = requestsFor(FAKE_MODEL);
  await page.getByRole('button', { name: 'Ask the AI for findings' }).click();
  await expect(card(page).getByRole('status')).toContainText(/The AI is reading part 2 of/);
  // Part 2's request has reached the model before anything is counted.
  await expect.poll(() => requestsFor(FAKE_MODEL)).toBe(before + 2);
  const sent = before + 2;
  const name = (await page
    .getByRole('link', { name: /^Karoo Freight / })
    .first()
    .textContent())!;
  await page.goto(`/#/c/${id}`);
  await page.getByRole('button', { name: 'Delete client…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete client…' });
  await dialog.getByLabel(`Type ${name} to confirm`).fill(name);
  await dialog.getByRole('button', { name: 'Delete client' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Clients' })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'StyleCode' });
  await expect(nav.getByRole('link', { name: 'The AI couldn’t finish “Slow from part two”' })).toBeVisible();
  await page.waitForTimeout(1000);
  expect(requestsFor(FAKE_MODEL)).toBe(sent);
});
