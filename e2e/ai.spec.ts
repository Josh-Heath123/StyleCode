import { expect, test, type Page } from '@playwright/test';
import { FAKE_MODEL, startFakeOllama, type FakeOllama } from './fakeOllama';
import { draw, node, openFreshProject, select, snapshot } from './helpers';

/**
 * The AI flow end to end: settings, the request through StyleCode's local
 * server to a model server (a fake Ollama that answers predictably), the
 * streamed reply, the proposal on the canvas, and accept, reject and undo.
 *
 * The tests share one settings file (the dev server's, a temporary file set in
 * playwright.config.ts), so they run one after another.
 */
test.describe.configure({ mode: 'serial' });

let fake: FakeOllama;
const HEADERS = { 'x-stylecode-ai': '1' };

test.beforeAll(async () => {
  fake = await startFakeOllama();
});

test.afterAll(async () => {
  await fake.close();
});

/** Points the app at the fake model server without going through the dialog. */
async function useFakeOllama(page: Page): Promise<void> {
  const response = await page.request.put('/api/ai/config', {
    headers: HEADERS,
    data: { provider: 'ollama', providers: { ollama: { baseUrl: fake.url, model: FAKE_MODEL, contextSize: 8192 } } },
  });
  expect(response.ok()).toBe(true);
  await page.evaluate(() => (window as any).stylecode.assistant.refresh());
  await expect(page.getByRole('button', { name: `AI settings: ${FAKE_MODEL}` })).toBeVisible();
}

/** A screen with three cards in it; returns their ids. */
async function screenWithCards(page: Page) {
  const screen = await draw(page, 'f', [400, 200], [920, 620]);
  const cards = [
    await draw(page, 'f', [430, 240], [570, 380]),
    await draw(page, 'f', [590, 240], [730, 380]),
    await draw(page, 'f', [750, 240], [890, 380]),
  ];
  await page.keyboard.press('Escape');
  return { screen, cards };
}

async function ask(page: Page, request: string): Promise<void> {
  await page.keyboard.press('/');
  const input = page.getByRole('textbox', { name: 'Ask AI' });
  await expect(input).toBeFocused();
  await input.fill(request);
  await input.press('Enter');
}

const assistant = (page: Page) => page.getByRole('region', { name: 'AI assistant' });

test('AI starts off, and settings keep API keys on the local server', async ({ page }) => {
  await openFreshProject(page);
  // Never touch a real settings file: the e2e server uses a temporary one.
  const config = await (await page.request.get('/api/ai/config', { headers: HEADERS })).json();
  expect(config.configPath, 'the e2e dev server must use its own settings file').toContain('stylecode-e2e');
  await page.request.put('/api/ai/config', {
    headers: HEADERS,
    data: {
      provider: 'off',
      providers: { ollama: { model: '', baseUrl: 'http://localhost:11434' }, openai: { model: '', apiKey: null } },
    },
  });
  await page.evaluate(() => (window as any).stylecode.assistant.refresh());

  // Off: the assistant explains how to set it up and nothing else happens.
  await expect(page.getByRole('button', { name: 'AI settings: AI off' })).toBeVisible();
  await page.getByRole('button', { name: 'Ask AI (/)' }).click();
  await expect(assistant(page)).toContainText('StyleCode works fully without AI');
  await assistant(page).getByRole('button', { name: 'Set up AI' }).click();

  const dialog = page.getByRole('dialog', { name: 'AI settings' });
  await expect(dialog.getByRole('radio', { name: /^Off/ })).toBeChecked();

  // An OpenAI-compatible service with a key: the key is saved but never comes back.
  await dialog.getByRole('radio', { name: /OpenAI-compatible/ }).click();
  await dialog.getByRole('button', { name: 'LM Studio' }).click();
  await expect(dialog.getByLabel('API address')).toHaveValue('http://localhost:1234/v1');
  await dialog.getByLabel('API key').fill('sk-e2e-secret-4242');
  await dialog.getByLabel('Model', { exact: true }).fill('local-model');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'AI settings: local-model' })).toBeVisible();

  const saved = await (await page.request.get('/api/ai/config', { headers: HEADERS })).text();
  expect(saved).not.toContain('sk-e2e-secret');
  expect(JSON.parse(saved).providers.openai).toMatchObject({ hasKey: true, keySource: 'file', model: 'local-model' });
  expect(await page.content()).not.toContain('sk-e2e-secret');

  // Ollama: checking the connection lists the installed models and picks one.
  await page.getByRole('button', { name: /^AI settings/ }).click();
  await expect(dialog.getByLabel('API key')).toHaveValue('');
  await expect(dialog.getByLabel('API key')).toHaveAttribute('placeholder', /Saved on this computer/);
  await dialog.getByRole('radio', { name: /Ollama/ }).click();
  await dialog.getByLabel('Ollama address').fill(fake.url);
  await dialog.getByRole('button', { name: 'Test connection' }).click();
  await expect(dialog).toContainText('Connected. 2 models available.');
  await expect(dialog.getByLabel('Model', { exact: true })).toHaveValue(FAKE_MODEL);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: `AI settings: ${FAKE_MODEL}` })).toBeVisible();
});

test('a request becomes a proposal on the canvas: accept applies it as one undo step', async ({ page }) => {
  await openFreshProject(page);
  await useFakeOllama(page);
  const { cards } = await screenWithCards(page);
  const before = await node(page, cards[0]);
  await select(page, [cards[0]]);

  await ask(page, 'make it dark');
  await expect(assistant(page)).toContainText('Gave it a dark background with rounded corners.');
  await expect(assistant(page)).toContainText('Changes 1 layer.');
  // Shown on the canvas in cantaloupe, not yet recorded.
  await expect(page.locator('.ov-proposal-changed')).toHaveCount(1);
  expect(await node(page, cards[0])).toMatchObject({ fill: '#11141a', radius: 16 });
  // Undo would reject it; nothing has been recorded yet.
  await expect(page.getByRole('button', { name: 'Reject the AI’s changes' })).toBeEnabled();

  // What the model was sent: the schema, the context window, the design with short ids.
  const sent = fake.requests[fake.requests.length - 1];
  expect(sent.model).toBe(FAKE_MODEL);
  expect(sent.options.num_ctx).toBe(8192);
  expect((sent.format as { required: string[] }).required).toEqual(['explanation', 'operations']);
  expect(sent.messages[0].role).toBe('system');
  expect(sent.messages[1].content).toMatch(/^ {2}\* e2 frame "Frame \d+" \d+×\d+ x=\d+ y=\d+/m);
  expect(sent.messages[1].content).toMatch(/Request: make it dark$/);

  await page.keyboard.press('Enter');
  await expect(assistant(page)).toBeHidden();
  await expect(page.locator('.ov-proposal-changed')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo AI: make it dark' })).toBeVisible();
  await page.keyboard.press('Control+z');
  expect(await node(page, cards[0])).toMatchObject({ fill: before.fill, radius: before.radius });
  await page.keyboard.press('Control+Shift+z');
  expect(await node(page, cards[0])).toMatchObject({ fill: '#11141a' });
});

test('reject puts the design back; during review the design is read-only and undo rejects', async ({ page }) => {
  await openFreshProject(page);
  await useFakeOllama(page);
  const { cards } = await screenWithCards(page);
  await select(page, [cards[1]]);
  const count = Object.keys((await snapshot(page)).doc.nodes).length;

  await ask(page, 'add a button');
  await expect(assistant(page)).toContainText('Added a blue button.');
  await expect(page.locator('.ov-proposal-changed')).toHaveCount(2);
  const proposed = await snapshot(page);
  expect(Object.keys(proposed.doc.nodes)).toHaveLength(count + 2);
  const button = Object.values(proposed.doc.nodes).find((n) => n.name === 'Button')!;
  expect(button.parentId).toBe(cards[1]);
  expect(proposed.doc.nodes[button.children[0]].text).toBe('Get started');

  // Esc rejects; the request stays in the input to refine.
  await page.keyboard.press('Escape');
  expect(Object.keys((await snapshot(page)).doc.nodes)).toHaveLength(count);
  await expect(page.getByRole('textbox', { name: 'Ask AI' })).toHaveValue('add a button');
  await expect(page.getByRole('textbox', { name: 'Ask AI' })).toBeFocused();

  const lastStep = () => page.evaluate(() => (window as any).stylecode.editor.history.peekUndo()?.id as number);
  const before = await lastStep();
  await page.getByRole('textbox', { name: 'Ask AI' }).press('Enter');
  await expect(assistant(page)).toContainText('Review the changes');
  // Edits wait until the proposal is accepted or rejected, so they never mix with unrecorded changes.
  const x = (await node(page, cards[1])).x;
  await page.keyboard.press('ArrowRight');
  await expect(page.getByText('Accept or reject the AI’s changes first: Enter accepts, Esc rejects.')).toBeVisible();
  const box = (await page.locator(`[data-node-id="${cards[1]}"]`).boundingBox())!;
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + 60, { steps: 5 });
  await page.mouse.up();
  const during = await snapshot(page);
  expect(during.doc.nodes[cards[1]].x).toBe(x);
  expect(Object.keys(during.doc.nodes)).toHaveLength(count + 2);
  await expect(page.locator('.ov-proposal-changed')).toHaveCount(2);

  // Undo (here the toolbar button) rejects the proposal, and nothing else.
  await page.getByRole('button', { name: 'Reject the AI’s changes' }).click();
  await expect(page.getByText('AI changes rejected.')).toBeVisible();
  const after = await snapshot(page);
  expect(Object.keys(after.doc.nodes)).toHaveLength(count);
  expect(after.doc.nodes[cards[1]].x).toBe(x);
  await expect(page.locator('.ov-proposal-changed')).toHaveCount(0);
  expect(await lastStep()).toBe(before);
});

test('a reply with mistakes gets one repair attempt; one that stays wrong changes nothing', async ({ page }) => {
  await openFreshProject(page);
  await useFakeOllama(page);
  const { cards } = await screenWithCards(page);
  await select(page, [cards[2]]);

  const start = fake.requests.length;
  await ask(page, 'broken: make it dark');
  await expect(assistant(page)).toContainText('Review the changes');
  expect(fake.requests.length - start).toBe(2);
  const repair = fake.requests[fake.requests.length - 1].messages;
  expect(repair.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
  expect(repair[3].content).toContain('there is no layer "e999"');
  await page.keyboard.press('Escape');

  const doc = JSON.stringify((await snapshot(page)).doc);
  await page.getByRole('textbox', { name: 'Ask AI' }).fill('nonsense');
  await page.getByRole('textbox', { name: 'Ask AI' }).press('Enter');
  await expect(assistant(page)).toContainText('The AI’s changes didn’t fit the design, so nothing was changed.');
  await assistant(page)
    .getByText(/What was wrong with the reply/)
    .click();
  await expect(assistant(page)).toContainText('The reply was not a JSON object.');
  expect(JSON.stringify((await snapshot(page)).doc)).toBe(doc);
  await expect(assistant(page).getByRole('button', { name: 'Try again' })).toBeVisible();

  // The model server failing is reported in plain words.
  await assistant(page).getByRole('button', { name: 'Edit request' }).click();
  await page.getByRole('textbox', { name: 'Ask AI' }).fill('fail');
  await page.getByRole('textbox', { name: 'Ask AI' }).press('Enter');
  await expect(assistant(page)).toContainText('model runner has unexpectedly stopped');
});

test('large deletions need a deliberate click, and Stop cancels a request', async ({ page }) => {
  await openFreshProject(page);
  await useFakeOllama(page);
  const { screen, cards } = await screenWithCards(page);
  await select(page, cards);

  await ask(page, 'remove these');
  const confirm = assistant(page).getByRole('button', { name: 'Delete 3 layers and apply' });
  await expect(confirm).toBeVisible();
  await expect(page.locator('.ov-proposal-removed')).toHaveCount(3);
  // Enter alone doesn't apply a large deletion.
  await page.keyboard.press('Enter');
  await expect(confirm).toBeVisible();
  await confirm.click();
  expect((await node(page, screen)).children).toEqual([]);
  await page.keyboard.press('Control+z');
  expect((await node(page, screen)).children).toEqual(cards);

  await select(page, [cards[0]]);
  await ask(page, 'slow');
  await expect(assistant(page)).toContainText('Writing changes…');
  await expect(assistant(page)).toContainText('Taking my');
  await assistant(page).getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByRole('textbox', { name: 'Ask AI' })).toBeVisible();
  await expect(page.locator('.ov-proposal-changed')).toHaveCount(0);
});

test('suggestions follow the selection, and work on the screen in view when nothing is selected', async ({ page }) => {
  await openFreshProject(page);
  await useFakeOllama(page);
  const { screen, cards } = await screenWithCards(page);

  await page.keyboard.press('/');
  await expect(assistant(page)).toContainText(/Change the screen “Frame \d+”/);
  await expect(assistant(page).getByRole('button', { name: 'Tidy this screen into a clean layout' })).toBeVisible();
  await assistant(page).getByRole('button', { name: 'Make the spacing more consistent' }).click();
  // The fake model can't do this one: it says so and proposes nothing.
  await expect(assistant(page)).toContainText('No changes');
  await expect(assistant(page)).toContainText('I can’t do that with the tools I have.');
  expect(fake.requests[fake.requests.length - 1].messages[1].content).toContain('You may change anything on this screen.');
  await assistant(page).getByRole('button', { name: 'OK' }).click();
  await expect(page.getByRole('textbox', { name: 'Ask AI' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(assistant(page)).toBeHidden();

  await select(page, [cards[0]]);
  await page.keyboard.press('/');
  await expect(assistant(page)).toContainText(/Change “Frame \d+”/);
  await assistant(page).getByRole('button', { name: 'Fill this with a heading, text and a button' }).click();
  await expect(assistant(page)).toContainText('Adds 2 layers.');
  await assistant(page)
    .getByRole('button', { name: /^Reject/ })
    .click();
  expect((await node(page, cards[0])).children).toEqual([]);
  expect((await node(page, screen)).children).toEqual(cards);
});
