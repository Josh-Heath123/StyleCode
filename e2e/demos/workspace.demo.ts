import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { startFakeOllama, type FakeOllama } from '../fakeOllama';
import { BAKERY, harbourBakery, openOrderPage, withUntoldSession } from '../harbour';
import { kickoff } from '../karoo';
import { card as transcriptCard, withRecording } from '../kickoffRecording';
import { focusOn, SCRIPTED_MODEL, scriptedReply, useScriptedModel } from './scenes';

/**
 * The README's screenshots of the consulting workspace (docs/presentation/PRESENTATION-BRIEF.md, P4), at 1440×900 and
 * 2×, from role-played clients (Karoo Freight, Harbour Bakery) in the demos' own data folder. The AI is a scripted
 * stand-in, so the pictures are repeatable; the README says so beside them. Transcription is the fake engine, replaying
 * the role-played kick-off's recorded output, as in the browser tests.
 */

test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, video: 'off' });

const SAMPLES = join(process.cwd(), 'docs', 'phase-2', 'samples', 'karoo-freight-kickoff');
/** Each scene's client is deleted after its picture, so the next can take the same role-played name. */
const forget = (page: Page, id: string, name: string) =>
  page.request.delete(`/api/workspace/companies/${id}`, {
    headers: { 'x-stylecode-workspace': '1' },
    data: { confirmName: name },
  });
/** The consultant in the role-play is Sam Naidoo; the fixtures name the settings' consultant "Sam Consultant". */
const asSamNaidoo = (page: Page) =>
  page.request.put('/api/workspace/settings', {
    headers: { 'x-stylecode-workspace': '1' },
    data: { consultantName: 'Sam Naidoo' },
  });
const shot = (page: Page, name: string) => page.screenshot({ path: join(process.cwd(), 'docs', 'media', `${name}.png`) });

/**
 * The scripted model's findings from Karoo Freight's kick-off: each quotes the passage it comes from word for word, as
 * a careful consultant would record it. Only passages found in the request are used.
 */
const FINDINGS = [
  {
    quote: 'It has to work offline and send everything when they’re back in range',
    kind: 'constraint',
    statement: 'The driver app works offline and sends everything once the driver is back in range.',
  },
  {
    quote: 'Accept the job, mark it collected, take a photo of the waybill, and get a signature',
    kind: 'functional-requirement',
    statement: 'Drivers accept a job, mark it collected, photograph the waybill and capture a signature.',
  },
  {
    quote: 'About a hundred and twenty a day',
    kind: 'scalability',
    statement: 'About 120 collections a day, roughly doubling in November and December.',
  },
  {
    quote: 'We miss collections because messages get buried',
    kind: 'operational-challenge',
    statement: 'Collections are missed because dispatch messages get buried in a WhatsApp group.',
  },
  {
    quote: 'Our MD signs off anything above two hundred thousand rand',
    kind: 'budget',
    statement: 'Spending above R200,000 needs the MD’s sign-off; a figure is wanted by the end of January.',
  },
];

/**
 * Asked to change the order page's Pay button with the record (Workspace Phase 4, decision 16), the scripted model
 * words the button from the findings it was given and names the two it drew on, by the short ids the request used.
 */
function fromTheRecord(first: string) {
  const layer = (name: string) => new RegExp(`^ *\\* (e\\d+) \\w+ "${name}"`, 'm').exec(first)?.[1];
  const finding = (words: string) => new RegExp(`^- (F\\d+) [\\w-]+: ".*${words}.*"$`, 'm').exec(first)?.[1];
  const label = layer('Pay label');
  const button = layer('Pay button');
  return {
    text: JSON.stringify({
      explanation:
        'The button now says the cake is paid for online when it’s ordered, as agreed. The two days’ notice is already shown under the date, so I left it there.',
      operations: [
        ...(button ? [{ op: 'update', id: button, set: { fill: '#1f5a41' } }] : []),
        ...(label ? [{ op: 'update', id: label, set: { text: 'Pay R 450 online and order' } }] : []),
      ],
      findings: [finding('pay online'), finding('notice')].filter(Boolean),
    }),
    delay: 30,
  };
}

function respond(body: FakeOllama['requests'][number]) {
  const first = body.messages.find((m) => m.role === 'user')?.content ?? '';
  if (/^- F\d+ /m.test(first)) return fromTheRecord(first);
  if (!body.messages[0]?.content.includes('list the findings a careful consultant would record')) return scriptedReply(body);
  const message = body.messages[body.messages.length - 1].content;
  const findings = [];
  for (const f of FINDINGS) {
    // The transcript's apostrophes may be straight or curly; the quote follows the passage.
    for (const quote of [f.quote, f.quote.replace(/’/g, "'")]) {
      const line = message.split('\n').find((l) => l.includes(quote) && /^\[S\d+\]/.test(l));
      if (!line) continue;
      findings.push({
        kind: f.kind,
        status: 'suggested',
        statement: f.statement,
        evidence: [{ ref: /^\[(S\d+)\]/.exec(line)![1], quote }],
      });
      break;
    }
  }
  return { text: JSON.stringify({ findings }), delay: 8 };
}

let fake: FakeOllama;
test.beforeAll(async () => {
  fake = await startFakeOllama({ respond, models: [SCRIPTED_MODEL] });
});
test.afterAll(async () => fake.close());

test('reviewing the AI’s proposals beside the transcript', async ({ page }) => {
  await page.goto('/');
  await useScriptedModel(page, fake);
  const id = await kickoff(page, { name: 'Karoo Freight' });
  await asSamNaidoo(page);
  await page.reload();
  await page.getByRole('button', { name: 'Import transcript…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import a transcript' });
  await dialog.getByLabel('File (.vtt, .docx or .txt)').setInputFiles(join(SAMPLES, 'teams-transcript.vtt'));
  await dialog.getByRole('button', { name: 'Import transcript' }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Ask the AI for findings' }).click();
  const proposals = page.getByRole('list', { name: /waiting for review/ }).locator('> li');
  await expect(proposals).toHaveCount(FINDINGS.length, { timeout: 30_000 });
  const first = proposals.first();
  await first.focus();
  await expect(page.locator('.ws-segment.is-quoted mark').first()).toBeVisible();
  // The transcript card's top at the top of the picture, so no sentence is cut in half.
  await page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Transcript', exact: true }) })
    .evaluate((el) => {
      // The page scrolls inside its own element, not the window: bring the card's top 16px below the top bar,
      // measured, because the scroller's top isn't the top bar's bottom.
      let scroller = el.parentElement;
      while (scroller && scroller.scrollHeight <= scroller.clientHeight) scroller = scroller.parentElement;
      const barBottom = document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0;
      scroller?.scrollBy(0, el.getBoundingClientRect().top - barBottom - 16);
    });
  await page.waitForTimeout(400);
  await shot(page, 'review-proposals');
  expect((await forget(page, id, 'Karoo Freight')).ok()).toBe(true);
});

test('a transcript made on this computer, speakers matched', async ({ page }) => {
  const { id } = await withRecording(page, { kind: 'days', days: 30 }, true, undefined, 'Karoo Freight');
  await transcriptCard(page).getByRole('button', { name: 'Transcribe…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Transcribe the recordings' });
  await dialog.getByLabel('Add the transcript when it’s ready').check();
  await dialog.getByRole('button', { name: 'Transcribe', exact: true }).click();
  await expect(transcriptCard(page)).toContainText('Transcribed on this computer by whisper.cpp', { timeout: 30_000 });
  for (const [label, who] of [
    ['Speaker 1', 'Sam Naidoo (your side)'],
    ['Speaker 2', 'Pieter van Wyk (client)'],
  ] as const) {
    await transcriptCard(page).getByLabel(`Who “${label}” is`).first().selectOption({ label: who });
  }
  // Speaker 3 is among the short labels: matched from one of its turns.
  await transcriptCard(page)
    .getByRole('button', { name: /^Match “Speaker 3” at/ })
    .first()
    .click();
  const match = page.getByRole('dialog', { name: 'Who is “Speaker 3”?' });
  await match.getByLabel('Participant').selectOption({ label: 'Thandi Mokoena (client)' });
  await match.getByRole('button', { name: 'Match' }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await transcriptCard(page).locator('.ws-unsure').first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await shot(page, 'transcript');
  expect((await forget(page, id, 'Karoo Freight')).ok()).toBe(true);
});

/**
 * The test fixture's Order page is three bare layers. For the picture it's dressed as a checkout, through the editor's
 * own operations, as one undoable step: copies of the fixture's text and rectangle (so every property is set) for the
 * new layers, and the date picker and Pay button keep their links to the findings.
 */
async function dressOrderPage(page: Page) {
  await page.evaluate((L) => {
    const editor = (window as any).stylecode.editor;
    const nodes = editor.getState().doc.nodes;
    const text = nodes[L.heading];
    const rect = nodes[L.date];
    let n = 0;
    const add = (base: any, props: Record<string, unknown>) => ({
      type: 'create',
      parentId: L.frame,
      index: nodes[L.frame].children.length + n,
      nodes: [{ ...base, findings: [], id: `n_demo_${n++}`, parentId: null, children: [], ...props }],
    });
    const label = (y: number, words: string, extra: Record<string, unknown> = {}) =>
      add(text, {
        name: words,
        text: words,
        x: 120,
        y,
        width: 480,
        height: 22,
        fontSize: 15,
        fontWeight: 600,
        fill: '#3b3530',
        ...extra,
      });
    const ops = [
      { type: 'update', id: L.heading, props: { fontSize: 48, fontWeight: 800, fill: '#231d18', y: 96, width: 520, height: 58 } },
      label(164, 'Harbour Bakery · collect from the Harbour Road shop', {
        fontWeight: 400,
        fontSize: 17,
        fill: '#6b625a',
        height: 24,
      }),
      add(rect, { name: 'Cake photo', x: 720, y: 96, width: 600, height: 420, radius: 20, fill: '#f1e2cf' }),
      add(rect, { name: 'Cake', x: 870, y: 196, width: 300, height: 220, radius: 110, fill: '#7a4a32' }),
      add(text, {
        name: 'Cake name',
        text: 'Chocolate celebration cake',
        x: 720,
        y: 540,
        width: 600,
        height: 34,
        fontSize: 26,
        fontWeight: 700,
        fill: '#231d18',
      }),
      add(text, {
        name: 'Price',
        text: 'R 450 · serves 12',
        x: 720,
        y: 582,
        width: 600,
        height: 24,
        fontSize: 17,
        fill: '#6b625a',
      }),
      label(238, 'Collection date'),
      {
        type: 'update',
        id: L.date,
        props: { y: 268, width: 480, height: 56, radius: 10, fill: '#f6f1ea', stroke: '#d9cfc3', strokeWidth: 1 },
      },
      add(text, {
        name: 'Date',
        text: 'Friday 14 November, from 08:00',
        x: 140,
        y: 285,
        width: 400,
        height: 22,
        fontSize: 16,
        fill: '#231d18',
      }),
      label(334, 'We need two days’ notice for every cake.', { fontWeight: 400, fontSize: 14, fill: '#6b625a' }),
      label(392, 'Message on the cake'),
      add(rect, {
        name: 'Message field',
        x: 120,
        y: 422,
        width: 480,
        height: 56,
        radius: 10,
        fill: '#f6f1ea',
        stroke: '#d9cfc3',
        strokeWidth: 1,
      }),
      add(text, {
        name: 'Message',
        text: 'Happy birthday, Nomsa',
        x: 140,
        y: 439,
        width: 400,
        height: 22,
        fontSize: 16,
        fill: '#231d18',
      }),
      { type: 'update', id: L.pay, props: { y: 516, width: 480, height: 60, radius: 12, fill: '#2b6b4f' } },
      add(text, {
        name: 'Pay label',
        text: 'Pay R 450 and order',
        x: 120,
        y: 534,
        width: 480,
        height: 24,
        fontSize: 18,
        fontWeight: 700,
        fill: '#ffffff',
        textAlign: 'center',
        textResize: 'fixed',
      }),
      { type: 'update', id: L.frame, props: { height: 680, fill: '#fffaf3' } },
    ];
    editor.apply(ops, { label: 'Dress the order page' });
  }, BAKERY.layers);
}

test('a client’s design beside its record, a layer showing its findings', async ({ page }) => {
  await page.goto('/');
  const { id } = await harbourBakery(page, 'Harbour Bakery');
  await openOrderPage(page, id);
  await expect(page.getByRole('complementary', { name: 'Record' })).toBeVisible();
  await dressOrderPage(page);
  await page.evaluate((pay) => (window as any).stylecode.editor.select([pay]), BAKERY.layers.pay);
  // Every operation applied: the order page's own layers and the copies.
  await expect
    .poll(() => page.evaluate(() => Object.keys((window as any).stylecode.editor.getState().doc.nodes).length))
    .toBeGreaterThan(15);
  await focusOn(page, BAKERY.layers.frame, 0.43, 20);
  await page.waitForTimeout(600);
  await shot(page, 'design-and-record');
  await page.goto('/');
  expect((await forget(page, id, 'Harbour Bakery')).ok()).toBe(true);
});

test('the canvas AI drawing on the record, saying which findings and how many were left out', async ({ page }) => {
  await page.goto('/');
  await useScriptedModel(page, fake);
  const { id } = await harbourBakery(page, 'Harbour Bakery');
  await asSamNaidoo(page);
  // A kick-off whose consent never told the client the AI may help sketch the screens: its finding is left out.
  await withUntoldSession(page, id);
  await openOrderPage(page, id);
  await dressOrderPage(page);
  const label = await page.evaluate(
    () =>
      Object.values((window as any).stylecode.editor.getState().doc.nodes as Record<string, { id: string; name: string }>).find(
        (n) => n.name === 'Pay label',
      )!.id,
  );
  await page.evaluate((ids) => (window as any).stylecode.editor.select(ids), [BAKERY.layers.pay, label]);
  await focusOn(page, BAKERY.layers.frame, 0.43, -96);
  await page.keyboard.press('/');
  const input = page.getByRole('textbox', { name: 'Ask AI' });
  await input.fill('Make the pay button say how the customer pays');
  await input.press('Enter');
  const panel = page.getByRole('region', { name: 'AI assistant' });
  await expect(panel.getByRole('list', { name: 'Drew on:' }).getByRole('link')).toHaveText([
    BAKERY.findings.pay.statement,
    BAKERY.findings.notice.statement,
  ]);
  await expect(panel).toContainText('1 finding left out: the client wasn’t told the AI may help sketch the screens.');
  await page.waitForTimeout(600);
  await shot(page, 'canvas-ai-record');
  await page.keyboard.press('Escape');
  await page.goto('/');
  expect((await forget(page, id, 'Harbour Bakery')).ok()).toBe(true);
});
