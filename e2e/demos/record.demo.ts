import { expect, test } from '@playwright/test';
import { startFakeOllama, type FakeOllama } from '../fakeOllama';
import { snapshot } from '../helpers';
import {
  box,
  clickAt,
  clickLocator,
  exampleProject,
  focusOn,
  glide,
  pause,
  saveGif,
  SCRIPTED_MODEL,
  scriptedReply,
  useScriptedModel,
} from './scenes';

/**
 * The demo GIFs in docs/media, recorded from the real editor: `npm run demos`.
 *
 * The AI demo uses a scripted stand-in model (it answers the note in the same
 * way every time), so the recording is repeatable. A real model's wording and
 * choices will differ; the README says so next to the GIF.
 */

test.describe.configure({ mode: 'serial' });

let fake: FakeOllama;
test.beforeAll(async () => {
  fake = await startFakeOllama({ respond: scriptedReply, models: [SCRIPTED_MODEL] });
});
test.afterAll(async () => fake.close());

// ---------------------------------------------------------------------------
// The scenes
// ---------------------------------------------------------------------------

test('sketch to layout to code', async ({ page }) => {
  const startedAt = Date.now();
  const { find, landing } = await exampleProject(page, false);
  const sceneStart = Date.now();
  await pause(page, 700);

  // Select the freely drawn page by its label and tidy it into rows and columns.
  const label = (await page.locator(`[data-frame-label="${landing}"]`).boundingBox())!;
  await clickAt(page, label.x + 30, label.y + label.height / 2);
  await pause(page, 500);
  await page.keyboard.press('Shift+A');
  await pause(page, 1600);

  // Drag the middle card to the front of its row.
  const shared = await box(page, await find('Shared by default card'));
  const tag = await box(page, await find('Tag as you go card'));
  await clickAt(page, shared.x + 10, shared.y + 10, { modifiers: ['Control'] });
  await pause(page, 400);
  await page.mouse.down();
  await page.mouse.move(tag.x + 20, shared.y + 14, { steps: 30 });
  await pause(page, 300);
  await page.mouse.up();
  await pause(page, 900);

  // The code for it, highlighted, then the page at phone width.
  await clickLocator(page, page.getByRole('tab', { name: 'Code' }));
  await pause(page, 2400);
  await clickLocator(page, page.getByRole('button', { name: 'Preview', exact: true }).first());
  await pause(page, 1300);
  await clickLocator(page, page.getByRole('radio', { name: /Mobile/ }));
  await pause(page, 2600);
  await saveGif(page, 'sketch-to-code', startedAt, sceneStart);
});

test('a note the AI follows (scripted model)', async ({ page }) => {
  const startedAt = Date.now();
  const { find } = await exampleProject(page, true);
  await useScriptedModel(page, fake);
  const middle = await find('Shared by default card');
  await focusOn(page, middle, 0.95, 60);
  await pause(page, 300);
  const sceneStart = Date.now();
  await pause(page, 600);

  // A note pinned to the card.
  await page.keyboard.press('n');
  await pause(page, 300);
  const card = await box(page, middle);
  await clickAt(page, card.x + card.width / 2, card.y + card.height / 2);
  await pause(page, 300);
  await page.keyboard.type('Make this card stand out: brand blue, white text', { delay: 28 });
  await pause(page, 500);
  await page.keyboard.press('Escape');
  await pause(page, 700);

  // Select the card and ask the AI to do what the note says.
  await clickAt(page, card.x + 12, card.y + card.height - 12, { modifiers: ['Control'] });
  await pause(page, 500);
  await page.keyboard.press('/');
  await pause(page, 900);
  await clickLocator(page, page.getByRole('button', { name: 'Do what the note says' }));
  await expect(page.getByRole('button', { name: /Accept/ })).toBeVisible({ timeout: 20_000 });
  await pause(page, 2200);
  await page.keyboard.press('Enter');
  await pause(page, 2200);
  await saveGif(page, 'notes-for-the-ai', startedAt, sceneStart);
});

test('grids and phones', async ({ page }) => {
  const startedAt = Date.now();
  const { find } = await exampleProject(page, true);
  const first = await find('Tag as you go card');
  const third = await find('Answers, not folders card');
  const row = (await snapshot(page)).doc.nodes[first].parentId!;
  await focusOn(page, row, 0.6, -40);
  await pause(page, 300);
  const sceneStart = Date.now();
  await pause(page, 600);

  // Select the row of cards (between two cards) and make it a grid of two columns.
  const a = await box(page, first);
  const b = await box(page, await find('Shared by default card'));
  await clickAt(page, (a.x + a.width + b.x) / 2, a.y + a.height / 2, { modifiers: ['Control'] });
  await pause(page, 600);
  await clickLocator(page, page.getByRole('group', { name: 'Direction' }).getByRole('button', { name: 'Grid' }));
  await pause(page, 1000);
  const cols = page.getByRole('textbox', { name: 'Columns', exact: true });
  await clickLocator(page, cols);
  await page.keyboard.press('Control+a');
  await page.keyboard.type('2', { delay: 60 });
  await page.keyboard.press('Enter');
  await pause(page, 1300);

  // The last card spans both columns.
  const c = await box(page, third);
  await clickAt(page, c.x + 12, c.y + 12, { modifiers: ['Control'] });
  await pause(page, 500);
  const span = page.getByRole('textbox', { name: 'Column span', exact: true });
  await clickLocator(page, span);
  await page.keyboard.press('Control+a');
  await page.keyboard.type('2', { delay: 60 });
  await page.keyboard.press('Enter');
  await pause(page, 1400);

  // At full width the grid has two columns; on a phone, one.
  await clickLocator(page, page.getByRole('button', { name: 'Preview', exact: true }).first());
  await pause(page, 900);
  const frame = (await page.locator('.preview iframe').boundingBox())!;
  await glide(page, frame.x + frame.width / 2, frame.y + frame.height / 2);
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, 120);
    await pause(page, 60);
  }
  await pause(page, 1600);
  await clickLocator(page, page.getByRole('radio', { name: /Mobile/ }));
  await pause(page, 700);
  const phone = (await page.locator('.preview iframe').boundingBox())!;
  await glide(page, phone.x + phone.width / 2, phone.y + phone.height / 2);
  for (let i = 0; i < 14; i++) {
    await page.mouse.wheel(0, 120);
    await pause(page, 60);
  }
  await pause(page, 2600);
  await saveGif(page, 'grids-and-phones', startedAt, sceneStart);
});
