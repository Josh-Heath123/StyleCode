import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { FAKE_MODEL, startFakeOllama, type FakeOllama } from './fakeOllama';
import { BAKERY, harbourBakery, openOrderPage, withUntoldSession } from './harbour';
import { expectHeavySlotFree } from './heavySlot';
import { withRecording } from './kickoffRecording';
import { openFreshProject, select } from './helpers';
import { E2E_WORKSPACE } from './workspaceFolder';
import { E2E_GPU_TEMPERATURE } from './workspacePath';

/**
 * The canvas AI with the engagement's record (Workspace Phase 4, decisions 14 to 18), against the fake Ollama: it
 * draws on the confirmed findings it may use and says which, says how many were left out by consent and why, takes
 * its turn behind a transcription, and the standalone editor takes its turn too but has no record. All role-played.
 */

// One heavy job at a time on the one test server (decision 17): these tests run in the heavy jobs project.
test.describe.configure({ mode: 'default' });
test.afterEach(async ({ request }) => {
  await expectHeavySlotFree(request);
});

const HEADERS = { 'x-stylecode-workspace': '1' };
let fake: FakeOllama;

test.beforeAll(async () => {
  fake = await startFakeOllama();
});
test.afterAll(async () => {
  await fake.close();
});

/** The page reads the AI settings as the fake model on this computer; the shared settings file isn't touched. */
async function aiOnFake(page: Page, model = FAKE_MODEL) {
  await page.route('**/api/ai/config', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({
          json: {
            provider: 'ollama',
            configPath: '',
            providers: {
              ollama: { baseUrl: fake.url, model, contextSize: 8192, hasKey: false, keySource: null },
              openai: { baseUrl: 'https://api.openai.com/v1', model: '', hasKey: false, keySource: null },
              anthropic: { baseUrl: 'https://api.anthropic.com', model: '', hasKey: false, keySource: null },
            },
          },
        })
      : route.fallback(),
  );
}

async function ask(page: Page, request: string) {
  await page.keyboard.press('/');
  const input = page.getByRole('textbox', { name: 'Ask AI' });
  await expect(input).toBeFocused();
  await input.fill(request);
  await input.press('Enter');
}

const assistant = (page: Page) => page.getByRole('region', { name: 'AI assistant' });
/** The canvas requests the fake model received since `from`, as the text of their first message. */
const canvasRequests = (from: number) =>
  fake.requests.slice(from).map((r) => r.messages.find((m) => m.role === 'user')?.content ?? '');

test('a request on an engagement’s design draws on its confirmed findings, and says which', async ({ page }) => {
  await aiOnFake(page);
  const { id } = await harbourBakery(page);
  await openOrderPage(page, id, BAKERY.layers.pay);
  const from = fake.requests.length;
  await ask(page, 'make paying obvious, from the record');

  const panel = assistant(page);
  await expect(
    panel.getByRole('heading', { name: 'Review the changes' }).or(panel.getByText('Review the changes')),
  ).toBeVisible();
  // What the model was given: the two confirmed findings of this engagement, statement and kind only, the Pay
  // button's first; never the assumption, the open question or the other engagement's.
  const [sent] = canvasRequests(from);
  // Ollama is asked not to think first: a thinking model's reasoning never reaches the reply.
  expect(fake.requests[from].think).toBe(false);
  expect(sent).toContain('- F1 functional-requirement: "Customers pay online when they order."');
  expect(sent).toContain('- F2 constraint: "Orders need two days’ notice."');
  expect(sent).toMatch(/\* e\d+ rect "Pay button" .*findings=F1/);
  for (const absent of [BAKERY.findings.pickup, BAKERY.findings.delivery, BAKERY.findings.wholesale])
    expect(sent).not.toContain(absent.statement);

  // "Drew on:", each a link to the record; F99, which it wasn't given, is only counted.
  const drewOn = panel.getByRole('list', { name: 'Drew on:' });
  await expect(drewOn.getByRole('link')).toHaveText([BAKERY.findings.pay.statement, BAKERY.findings.notice.statement]);
  await expect(drewOn.getByRole('link', { name: BAKERY.findings.pay.statement })).toHaveAttribute(
    'href',
    `#/c/${id}/e/${BAKERY.engagementId}/record/f/${BAKERY.findings.pay.id}`,
  );
  await expect(panel).toContainText('The AI also named a finding it wasn’t given, so it is ignored.');
  expect((await new AxeBuilder({ page }).include('.assistant').analyze()).violations).toEqual([]);

  // The AI can't link layers: accepting changes the button's fill, and its links stay as they were.
  await page.keyboard.press('Enter');
  await expect(panel).toHaveCount(0);
  await expect
    .poll(() => {
      const file = JSON.parse(
        readFileSync(join(E2E_WORKSPACE, 'companies', id, 'designs', `${BAKERY.documentId}.stylecode.json`), 'utf8'),
      ) as { document: { nodes: Record<string, { fill: string; findings: string[] }> } };
      const pay = file.document.nodes[BAKERY.layers.pay];
      return [pay.fill, pay.findings];
    })
    .toEqual(['#2f7bff', [BAKERY.findings.pay.id]]);
});

test('a finding whose session wasn’t told the AI may sketch the screens is left out, and the assistant says so', async ({
  page,
}) => {
  await aiOnFake(page);
  const { id } = await harbourBakery(page);
  await withUntoldSession(page, id);
  await openOrderPage(page, id, BAKERY.layers.pay);
  const from = fake.requests.length;
  await ask(page, 'make the photos stand out, from the record');

  const panel = assistant(page);
  await expect(panel).toContainText('1 finding left out: the client wasn’t told the AI may help sketch the screens.');
  await expect(panel.getByRole('list', { name: 'Drew on:' }).getByRole('link')).toHaveText([
    BAKERY.findings.pay.statement,
    BAKERY.findings.notice.statement,
  ]);
  expect((await new AxeBuilder({ page }).include('.assistant').analyze()).violations).toEqual([]);
  const [sent] = canvasRequests(from);
  expect(sent).not.toContain('Cake photos are shown large.');
  expect(sent).not.toContain('Nomsa');
  await page.keyboard.press('Escape');
});

test('a request on a model on this computer waits its turn behind a transcription, says so, then runs', async ({ page }) => {
  await aiOnFake(page);
  const { id } = await harbourBakery(page);
  // Karoo Freight's kick-off is transcribed, on a graphics card hot enough that it holds the slot while it cools.
  const karoo = await withRecording(page);
  writeFileSync(E2E_GPU_TEMPERATURE, '92');
  try {
    const started = await page.request.post(`/api/workspace/companies/${karoo.id}/transcriptions`, {
      headers: HEADERS,
      data: { sessionId: 'se_1', recordingIds: [karoo.fileId] },
    });
    expect(started.ok(), await started.text()).toBe(true);
    await openOrderPage(page, id, BAKERY.layers.pay);
    const from = fake.requests.length;
    await ask(page, 'make paying obvious, from the record');
    const panel = assistant(page);
    await expect(panel).toContainText(
      'Waiting: a transcription is going on this computer, and one heavy job runs at a time. The AI starts when that finishes.',
    );
    await expect(panel.getByRole('button', { name: 'Stop' })).toBeVisible();
    expect((await new AxeBuilder({ page }).include('.assistant').analyze()).violations).toEqual([]);
    // Nothing is sent to the model while it waits.
    expect(fake.requests.length).toBe(from);
  } finally {
    rmSync(E2E_GPU_TEMPERATURE, { force: true });
  }
  // The transcription finishes, and the request runs.
  await expect(assistant(page)).toContainText('Review the changes', { timeout: 30_000 });
  await page.keyboard.press('Escape');
});

test('a model without thinking is sent no "think" at all, and still answers (Phase 5, decision 24)', async ({ page }) => {
  // The fake's other model lists no thinking capability in /api/show; Ollama is asked, and the request leaves think out.
  await aiOnFake(page, 'other-model:3b');
  const { id } = await harbourBakery(page);
  await openOrderPage(page, id, BAKERY.layers.pay);
  const from = fake.requests.length;
  await ask(page, 'make paying obvious, from the record');
  await expect(assistant(page)).toContainText('Review the changes');
  expect(fake.requests[from].model).toBe('other-model:3b');
  expect(fake.requests[from]).not.toHaveProperty('think');
  await page.keyboard.press('Escape');
});

test('a request on this computer lets a hot graphics card cool first, and Don’t wait sends it', async ({ page }) => {
  await aiOnFake(page);
  const { id } = await harbourBakery(page);
  await openOrderPage(page, id, BAKERY.layers.pay);
  const from = fake.requests.length;
  writeFileSync(E2E_GPU_TEMPERATURE, '90');
  try {
    await ask(page, 'make paying obvious, from the record');
    const panel = assistant(page);
    await expect(panel).toContainText('Letting the graphics card cool: 90 °C. It starts again when the card is under 75 °C.');
    expect(fake.requests.length).toBe(from);
    expect((await new AxeBuilder({ page }).include('.assistant').analyze()).violations).toEqual([]);
    await panel.getByRole('button', { name: 'Don’t wait for the graphics card to cool' }).click();
    // The wait reads the card every 5 s, and goes on at its next reading (as an extraction run does).
    await expect(panel).toContainText('Review the changes', { timeout: 20_000 });
  } finally {
    rmSync(E2E_GPU_TEMPERATURE, { force: true });
  }
  await page.keyboard.press('Escape');
});

test('the standalone editor waits its turn for the slot too, then sends no findings and no consent check', async ({ page }) => {
  // Something holds the heavy slot: the standalone editor's request on a model on this computer waits for it too
  // (Workspace Phase 5, decision 24), and runs when it's let go.
  const lease = (await (
    await page.request.post('/api/workspace/heavy', { headers: HEADERS, data: { kind: 'extraction' } })
  ).json()) as { id: string };
  try {
    await aiOnFake(page);
    const sent: Record<string, unknown>[] = [];
    await page.route('**/api/ai/chat', async (route) => {
      sent.push(route.request().postDataJSON() as Record<string, unknown>);
      const text = JSON.stringify({ explanation: 'Darkened it.', operations: [] });
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/x-ndjson' },
        body: `${JSON.stringify({ delta: text })}\n{"done":true}\n`,
      });
    });
    await openFreshProject(page);
    await page.evaluate(() =>
      (window as unknown as { stylecode: { assistant: { refresh(): Promise<void> } } }).stylecode.assistant.refresh(),
    );
    const doc = await page.evaluate(
      () =>
        (
          window as unknown as {
            stylecode: { editor: { getState(): { doc: { rootId: string; nodes: Record<string, { children: string[] }> } } } };
          }
        ).stylecode.editor.getState().doc,
    );
    await select(page, [doc.nodes[doc.rootId].children[0]]);
    await ask(page, 'make it dark');
    const panel = assistant(page);
    await expect(panel).toContainText(
      'Waiting: an AI run is going on this computer, and one heavy job runs at a time. The AI starts when that finishes.',
    );
    await expect(panel.getByRole('button', { name: 'Stop' })).toBeVisible();
    expect((await new AxeBuilder({ page }).include('.assistant').analyze()).violations).toEqual([]);
    expect(sent).toHaveLength(0);
    await page.request.delete(`/api/workspace/heavy/${lease.id}`, { headers: HEADERS });
    await expect(panel).toContainText('No changes');
    expect(sent).toHaveLength(1);
    const body = sent[0] as { system: string; schema: { properties: Record<string, unknown> }; messages: { content: string }[] };
    expect(body).not.toHaveProperty('provider');
    expect(body.system).not.toContain('FINDINGS');
    expect(body.schema.properties).not.toHaveProperty('findings');
    expect(body.messages[0].content).not.toContain('Confirmed findings');
    await page.keyboard.press('Escape');
  } finally {
    await page.request.delete(`/api/workspace/heavy/${lease.id}`, { headers: HEADERS });
  }
});
