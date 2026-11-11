import { expect, test } from '@playwright/test';
import { centerOf, dragBy, draw, node, openFreshProject, selected, snapshot } from './helpers';

test.beforeEach(async ({ page }) => openFreshProject(page));

test('draws a rectangle inside the frame, moves it, and undoes and redoes', async ({ page }) => {
  const rect = await draw(page, 'r', [420, 300], [560, 400]);
  const snap = await snapshot(page);
  const frame = snap.doc.nodes[snap.doc.rootId].children[0];
  expect(snap.doc.nodes[rect].parentId).toBe(frame);
  expect(snap.selection).toEqual([rect]);

  const before = await node(page, rect);
  await dragBy(page, await centerOf(page, rect), 40, 0);
  const moved = await node(page, rect);
  expect(moved.x).toBeGreaterThan(before.x + 50);

  await page.keyboard.press('Control+z');
  expect((await node(page, rect)).x).toBe(before.x);
  await page.keyboard.press('Control+Shift+z');
  expect((await node(page, rect)).x).toBe(moved.x);
});

test('resizes from a corner handle and rotates from outside a corner', async ({ page }) => {
  const rect = await draw(page, 'r', [420, 300], [560, 400]);
  const before = await node(page, rect);
  const handle = (await page.locator('[data-handle="se"]').boundingBox())!;
  await dragBy(page, { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }, 60, 40);
  const resized = await node(page, rect);
  expect(resized.width).toBeGreaterThan(before.width);
  expect(resized.height).toBeGreaterThan(before.height);

  const rotate = (await page.locator('[data-rotate="ne"]').boundingBox())!;
  await dragBy(page, { x: rotate.x + rotate.width / 2, y: rotate.y + rotate.height / 2 }, 40, 80);
  expect((await node(page, rect)).rotation).not.toBe(0);
});

test('creates text, sizes it to its content, and discards empty text', async ({ page }) => {
  await page.keyboard.press('t');
  await page.mouse.click(700, 300);
  await page.keyboard.type('Hello StyleCode');
  await page.keyboard.press('Escape');
  const [id] = await selected(page);
  const text = await node(page, id);
  expect(text.text).toBe('Hello StyleCode');
  expect(text.width).toBeGreaterThan(60);

  await page.keyboard.press('t');
  await page.mouse.click(700, 500);
  await page.keyboard.press('Escape');
  const texts = Object.values((await snapshot(page)).doc.nodes).filter((n) => n.type === 'text');
  expect(texts).toHaveLength(1);
});

test('edits properties from the panel as single undo steps', async ({ page }) => {
  const rect = await draw(page, 'r', [420, 300], [560, 400]);
  const width = page.getByLabel('Width', { exact: true });
  await width.fill('300/2+10');
  await width.press('Enter');
  await expect.poll(async () => (await node(page, rect)).width).toBe(160);

  const hex = page.getByLabel('Fill hex value');
  await hex.fill('2F7BFF');
  await hex.press('Enter');
  await expect.poll(async () => (await node(page, rect)).fill).toBe('#2f7bff');

  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await node(page, rect)).fill).not.toBe('#2f7bff');
});

test('a panel field left before the next frame keeps the focus away, so Ctrl+Z undoes', async ({ page }) => {
  const rect = await draw(page, 'r', [420, 300], [560, 400]);
  // A slow frame: the field's text is selected only after Enter has left it.
  await page.evaluate(() => {
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => {
      setTimeout(() => raf(cb), 300);
      return 0;
    };
  });
  const hex = page.getByLabel('Fill hex value');
  await hex.fill('2F7BFF');
  await hex.press('Enter');
  await expect.poll(async () => (await node(page, rect)).fill).toBe('#2f7bff');
  await page.waitForTimeout(400);
  await expect(hex).not.toBeFocused();
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await node(page, rect)).fill).not.toBe('#2f7bff');
});

test('keeps the project after a reload', async ({ page }) => {
  await draw(page, 'r', [420, 300], [560, 400]);
  const name = page.getByLabel('Design name');
  await name.fill('Reload check');
  await name.press('Enter');
  await expect(page.locator('.save-status')).toHaveText('Saved on this device');
  const before = await snapshot(page);
  await page.reload();
  await page.waitForSelector('.canvas');
  const after = await snapshot(page);
  expect(after.doc.name).toBe('Reload check');
  expect(Object.keys(after.doc.nodes).sort()).toEqual(Object.keys(before.doc.nodes).sort());
});
