import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { FAKE_MODEL, startFakeOllama, type FakeOllama } from './fakeOllama';
import { kickoff } from './karoo';
import { E2E_WORKSPACE } from './workspaceFolder';

/**
 * Asking the AI for findings from a session (MVP 6.1; Phase 2 brief, WP6),
 * through the real local AI server to a fake Ollama that answers
 * predictably. The AI settings are served to the page by the test, and each
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

test('asking for findings: the proposals wait for review, what failed the checks is counted, and undo removes them', async ({
  page,
}) => {
  await aiSettings(page, { provider: 'ollama', model: FAKE_MODEL });
  const id = await kickoff(page);
  await importTranscript(page);
  await expect(card(page)).toContainText(
    `The AI reads this session’s transcript and notes, and nothing else, using ${FAKE_MODEL}, on this computer.`,
  );
  await page.getByRole('button', { name: 'Ask the AI for findings' }).click();
  await expect(card(page).getByRole('status').first()).toContainText(/The AI proposed \d+ findings to review\./);
  await expect(card(page)).toContainText(
    'Not shown, because they failed StyleCode’s checks: 1 quoted words that aren’t in the passage.',
  );
  await expect(card(page)).toContainText(/\d+ proposals waiting for review\./);

  // Sent once, to the model that was checked, with thinking off.
  const sent = fake.requests.at(-1)!;
  expect(sent.model).toBe(FAKE_MODEL);
  expect((sent as unknown as { think: boolean }).think).toBe(false);
  expect(sent.messages[1].content).toContain('Thandi Mokoena (client): ');

  await expect.poll(() => Object.keys(onDisk(id).findings).length).toBeGreaterThan(0);
  const findings = Object.values(onDisk(id).findings);
  for (const f of findings) {
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

  // Asking again proposes nothing new: every proposal repeats one under review.
  await page.getByRole('button', { name: 'Ask the AI for findings' }).click();
  await expect(card(page)).toContainText('The AI proposed nothing new.');
  await expect(card(page)).toContainText(/\d+ repeated a finding already in this engagement or proposed again/);

  await page.keyboard.press('Control+z');
  await expect(card(page)).not.toContainText('waiting for review');
  await expect.poll(() => Object.keys(onDisk(id).findings).length).toBe(0);
});

test('Stop ends a run and saves nothing', async ({ page }) => {
  await aiSettings(page, { provider: 'ollama', model: FAKE_MODEL });
  const id = await kickoff(page, { title: 'A slow kick-off' });
  await importTranscript(page);
  await page.getByRole('button', { name: 'Ask the AI for findings' }).click();
  await expect(card(page).getByRole('status')).toContainText('The AI is reading the session…');
  await card(page).getByRole('button', { name: 'Stop' }).click();
  await expect(card(page).getByRole('alert')).toHaveText('Stopped. Nothing was saved.');
  expect(Object.keys(onDisk(id).findings)).toHaveLength(0);
  await expect(page.getByRole('button', { name: 'Ask the AI for findings' })).toBeVisible();
});

test('when the model fails, the session says so and nothing is saved', async ({ page }) => {
  await aiSettings(page, { provider: 'ollama', model: FAKE_MODEL });
  const id = await kickoff(page, { title: 'A kick-off that will fail' });
  await importTranscript(page);
  await page.getByRole('button', { name: 'Ask the AI for findings' }).click();
  await expect(card(page).getByRole('alert')).toContainText(
    'Ollama returned an error (500): model runner has unexpectedly stopped',
  );
  await expect(card(page).getByRole('alert')).toContainText('Nothing was saved.');
  expect(Object.keys(onDisk(id).findings)).toHaveLength(0);
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
  await expect(card(page).getByRole('alert')).toHaveText(
    'The AI settings changed while the AI was working, so it stopped. Nothing was saved.',
  );
  expect(requestsFor(FAKE_MODEL) - before).toBe(1);
  expect(requestsFor('gpt-oss:120b-cloud')).toBe(0);
  expect(Object.keys(onDisk(id).findings)).toHaveLength(0);
  // Back on the page, the cloud model isn't offered.
  await expect(card(page)).toContainText('The client did not agree to an external AI provider.');
});

test('the card passes the accessibility checks, before and after a run', async ({ page }) => {
  await aiSettings(page, { provider: 'ollama', model: FAKE_MODEL });
  await kickoff(page);
  await importTranscript(page);
  const check = async () =>
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations).toEqual(
      [],
    );
  await check();
  await page.getByRole('button', { name: 'Ask the AI for findings' }).focus();
  await page.keyboard.press('Enter');
  await expect(card(page)).toContainText(/proposals waiting for review/);
  await check();
});
