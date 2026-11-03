import { expect, test, type Page } from '@playwright/test';
import { centerOf, draw, node, openFreshProject, select, snapshot } from './helpers';

test.beforeEach(async ({ page }) => openFreshProject(page));

const lastUndo = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as { stylecode: { editor: { history: { peekUndo(): { label: string } | undefined } } } }
      ).stylecode.editor.history.peekUndo()?.label ?? null,
  );

/** Draws three squares in a line and wraps them in a row with Shift+A. */
async function rowOfThree(page: Page) {
  const a = await draw(page, 'r', [400, 300], [450, 350]);
  const b = await draw(page, 'r', [480, 300], [530, 340]);
  const c = await draw(page, 'r', [560, 300], [610, 360]);
  await select(page, [a, b, c]);
  await page.keyboard.press('Shift+A');
  const [rowId] = (await snapshot(page)).selection;
  return { a, b, c, rowId };
}

test('arrow keys move selected neighbours together, in both directions', async ({ page }) => {
  const { a, b, c, rowId } = await rowOfThree(page);
  await select(page, [a, b]);
  await page.keyboard.press('ArrowRight');
  expect((await node(page, rowId)).children).toEqual([c, a, b]);
  await page.keyboard.press('ArrowRight'); // already at the end: nothing changes
  expect((await node(page, rowId)).children).toEqual([c, a, b]);
  await page.keyboard.press('ArrowLeft');
  expect((await node(page, rowId)).children).toEqual([a, b, c]);
});

test('typing a size fixes that axis; align leaves auto layout alone', async ({ page }) => {
  const { a, b, c, rowId } = await rowOfThree(page);
  await select(page, [rowId]);
  await page.getByLabel('Width', { exact: true }).fill('400');
  await page.getByLabel('Width', { exact: true }).press('Enter');
  expect(await node(page, rowId)).toMatchObject({ width: 400, widthMode: 'fixed', heightMode: 'hug' });

  // Layers placed by auto layout can't be aligned: nothing moves and no undo step is added.
  await select(page, [a, b, c]);
  const before = await lastUndo(page);
  await page.keyboard.press('Alt+S');
  expect(await lastUndo(page)).toBe(before);
  await expect(page.getByRole('button', { name: 'Distribute horizontally' })).toBeDisabled();
});

test('dragging a card over a card of the same size reorders instead of nesting', async ({ page }) => {
  const one = await draw(page, 'f', [400, 300], [500, 420]);
  const two = await draw(page, 'f', [530, 300], [630, 420]);
  await select(page, [one, two]);
  await page.keyboard.press('Shift+A');
  const [rowId] = (await snapshot(page)).selection;

  await select(page, [one]);
  const from = await centerOf(page, one);
  const over = await centerOf(page, two);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(over.x + 30, over.y, { steps: 10 });
  await page.mouse.up();
  expect((await node(page, one)).parentId).toBe(rowId);
  expect((await node(page, rowId)).children).toEqual([two, one]);
});

test('removing a fill removes its gradient too', async ({ page }) => {
  const id = await draw(page, 'r', [400, 300], [500, 400]);
  await page.evaluate(
    (rect) =>
      (
        window as unknown as { stylecode: { editor: { apply(ops: unknown[], o: { label: string }): void } } }
      ).stylecode.editor.apply([{ type: 'update', id: rect, props: { gradientTo: '#0000ff' } }], { label: 'Gradient' }),
    id,
  );
  await page.getByRole('button', { name: 'Remove fill' }).click();
  expect(await node(page, id)).toMatchObject({ fill: null, gradientTo: null });
  const background = await page.locator(`[data-node-id="${id}"]`).evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(background).toBe('none');
});

test('an image that finishes loading during a drag waits for the drag to end', async ({ page }) => {
  const id = await draw(page, 'r', [400, 300], [500, 400]);
  const start = await node(page, id);
  const from = await centerOf(page, id);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 40, from.y, { steps: 4 });

  // Start adding an image (a generated PNG) while the drag is in progress.
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 40;
    canvas.height = 30;
    canvas.getContext('2d')!.fillRect(0, 0, 40, 30);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
    // Straight from the dev server, so it is the module the app itself uses.
    const load = (path: string): Promise<any> => import(/* @vite-ignore */ path);
    const { insertImageFiles } = await load('/src/app/insert.ts');
    const w = window as unknown as { stylecode: { editor: unknown }; __inserting: Promise<void> };
    w.__inserting = insertImageFiles(w.stylecode.editor, [new File([blob], 'photo.png', { type: 'image/png' })]);
  });
  await page.waitForTimeout(500);
  await page.mouse.move(from.x + 80, from.y, { steps: 4 });
  // Still dragging, and no image yet.
  expect(Object.values((await snapshot(page)).doc.nodes).some((n) => n.type === 'image')).toBe(false);
  await page.mouse.up();
  await page.evaluate(() => (window as unknown as { __inserting: Promise<void> }).__inserting);

  expect((await node(page, id)).x).toBeCloseTo(start.x + 80 / (await snapshot(page)).camera.zoom, 0);
  expect(Object.values((await snapshot(page)).doc.nodes).some((n) => n.type === 'image')).toBe(true);
});
