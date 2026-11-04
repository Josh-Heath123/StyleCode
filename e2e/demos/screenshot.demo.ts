import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { startFakeOllama, type FakeOllama } from '../fakeOllama';
import { box, exampleProject, focusOn, pause, SCRIPTED_MODEL, scriptedReply, useScriptedModel } from './scenes';

/** The screenshot at the top of the README (docs/editor.png), at 2× for sharp text. */

test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, video: 'off' });

let fake: FakeOllama;
test.beforeAll(async () => {
  fake = await startFakeOllama({ respond: scriptedReply, models: [SCRIPTED_MODEL] });
});
test.afterAll(async () => fake.close());

test('editor with a note, the code and the assistant', async ({ page }) => {
  const { find } = await exampleProject(page, true);
  await useScriptedModel(page, fake);
  const middle = await find('Shared by default card');
  await focusOn(page, middle, 0.62, -90);
  await page.keyboard.press('n');
  const card = await box(page, middle);
  await page.mouse.click(card.x + card.width / 2, card.y + card.height / 2);
  await page.keyboard.type('Make this card stand out: brand blue, white text');
  await page.keyboard.press('Escape');
  await page.evaluate((id) => (window as any).stylecode.editor.select([id]), middle);
  await page.getByRole('tab', { name: 'Code' }).click();
  await page.keyboard.press('/');
  await expect(page.getByRole('button', { name: 'Do what the note says' })).toBeVisible();
  // Out of the picture: the demo pointer, and the key badges (they fade after a second).
  await page.evaluate(() => document.querySelector('.demo-cursor')?.remove());
  await pause(page, 1500);
  await page.screenshot({ path: join(process.cwd(), 'docs', 'editor.png') });
});
