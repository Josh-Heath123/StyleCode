import { expect, test, type Page } from '@playwright/test';
import { centerOf, dragBy, draw, node, openFreshProject, select, selected, snapshot } from './helpers';

/** Phase 5 editing: notes for the AI, grids, phone overrides, corners and spacing guides. */

test.beforeEach(async ({ page }) => openFreshProject(page));

async function rename(page: Page, id: string, name: string): Promise<void> {
  await page.evaluate(
    ([id, name]) =>
      (
        window as unknown as { stylecode: { editor: { apply(ops: unknown[], o: { label: string }): void } } }
      ).stylecode.editor.apply([{ type: 'update', id, props: { name } }], { label: 'Rename' }),
    [id, name],
  );
}

test('a note pinned to a layer points at it, stays out of the code, and can be re-pointed', async ({ page }) => {
  const rect = await draw(page, 'r', [420, 300], [560, 400]);
  await page.keyboard.press('n');
  await page.mouse.click(...(Object.values(await centerOf(page, rect)) as [number, number]));
  await page.keyboard.type('Make this the brand colour');
  await page.keyboard.press('Escape');

  const snap = await snapshot(page);
  const note = Object.values(snap.doc.nodes).find((n) => n.type === 'note')!;
  expect(note.parentId).toBe(snap.doc.rootId);
  expect(note.noteTarget).toBe(rect);
  expect(note.text).toBe('Make this the brand colour');
  await expect(page.locator('.ov-note-arrow')).toHaveCount(1);

  // Never in the exported code.
  await page.getByRole('tab', { name: 'Code' }).click();
  await expect(page.locator('.code-view')).not.toContainText('brand colour');
  await page.getByRole('tab', { name: 'Design' }).click();

  // Remove the arrow, then drag the connector dot back onto the rectangle.
  await select(page, [note.id]);
  await page.getByRole('button', { name: 'Remove arrow' }).click();
  expect((await node(page, note.id)).noteTarget).toBe('');
  await expect(page.locator('.ov-note-arrow')).toHaveCount(0);

  const dot = (await page.locator('.ov-connector-dot').boundingBox())!;
  const target = await centerOf(page, rect);
  await page.mouse.move(dot.x + dot.width / 2, dot.y + dot.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 8 });
  await page.mouse.up();
  expect((await node(page, note.id)).noteTarget).toBe(rect);

  // Dragged over a frame, a note stays on the canvas rather than going inside it.
  const frame = snap.doc.nodes[snap.doc.rootId].children.find((id) => snap.doc.nodes[id].type === 'frame')!;
  await select(page, [note.id]);
  const from = await centerOf(page, note.id);
  const into = await centerOf(page, frame);
  await dragBy(page, from, into.x - from.x, into.y - from.y + 80);
  const after = await node(page, note.id);
  expect(after.parentId).toBe(snap.doc.rootId);
  expect(after.y).not.toBe(note.y);
});

test('a frame becomes a grid from the panel, items span columns, and phones get their own layout', async ({ page }) => {
  const ids: string[] = [];
  for (const x of [400, 520, 640, 760]) ids.push(await draw(page, 'r', [x, 300], [x + 90, 360]));
  const frame = (await node(page, ids[0])).parentId!;
  await rename(page, ids[3], 'Promo badge');

  await select(page, [frame]);
  await page.keyboard.press('Shift+A');
  await page.getByRole('group', { name: 'Direction' }).getByRole('button', { name: 'Grid' }).click();
  expect((await node(page, frame)).layout).toBe('grid');

  const cols = page.getByRole('textbox', { name: 'Columns', exact: true });
  await cols.fill('2');
  await cols.press('Enter');
  expect((await node(page, frame)).columns).toBe(2);
  const box = async (id: string) => (await page.locator(`[data-node-id="${id}"]`).boundingBox())!;
  const [a, b, c] = [await box(ids[0]), await box(ids[1]), await box(ids[2])];
  expect(Math.abs(a.y - b.y)).toBeLessThan(1);
  expect(c.y).toBeGreaterThan(a.y + a.height - 1);
  expect(Math.abs(c.x - a.x)).toBeLessThan(1);

  // The third tile spans both columns.
  await select(page, [ids[2]]);
  const span = page.getByRole('textbox', { name: 'Column span', exact: true });
  await span.fill('2');
  await span.press('Enter');
  const wide = await box(ids[2]);
  expect(wide.width).toBeGreaterThan(a.width * 2);

  // Hide the badge on phones: still on the canvas, gone from the phone preview.
  await select(page, [ids[3]]);
  await page.locator('summary', { hasText: 'On phones' }).click();
  await page.getByRole('checkbox', { name: 'Hide on phones' }).check();
  expect((await node(page, ids[3])).hideOnMobile).toBe(true);
  await expect(page.locator(`[data-node-id="${ids[3]}"]`)).toBeVisible();

  await page.getByRole('button', { name: 'Preview', exact: true }).first().click();
  const preview = page.frameLocator('.preview iframe');
  await expect(preview.locator('.promo-badge')).toBeVisible();
  await page.getByRole('radio', { name: /Mobile/ }).click();
  await expect(preview.locator('.promo-badge')).toBeHidden();
});

test('corners can be rounded one at a time', async ({ page }) => {
  const rect = await draw(page, 'r', [420, 300], [560, 400]);
  await page.getByRole('button', { name: 'Independent corners' }).click();
  const topLeft = page.getByRole('textbox', { name: 'Top-left radius' });
  await topLeft.fill('24');
  await topLeft.press('Enter');
  const n = await node(page, rect);
  expect(n.independentCorners).toBe(true);
  expect([n.radiusTopLeft, n.radiusTopRight, n.radiusBottomRight, n.radiusBottomLeft]).toEqual([24, 0, 0, 0]);
  const radius = await page.locator(`[data-node-id="${rect}"]`).evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
  expect(radius).toBe('24px');
});

test('dragging shows equal-spacing guides and snaps to the same gap; Alt shows distances', async ({ page }) => {
  const a = await draw(page, 'r', [400, 300], [460, 360]);
  const b = await draw(page, 'r', [500, 300], [560, 360]);
  const c = await draw(page, 'r', [640, 420], [700, 480]);
  const snap = await snapshot(page);
  const [na, nb, nc] = [snap.doc.nodes[a], snap.doc.nodes[b], snap.doc.nodes[c]];
  const gap = nb.x - (na.x + na.width);
  const zoom = snap.camera.zoom;

  // Drag the third so it is level with the others and 3px short of the same gap.
  const from = await centerOf(page, c);
  const dx = (nb.x + nb.width + gap - 3 - nc.x) * zoom;
  const dy = (na.y - nc.y) * zoom;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 10 });
  const guides = (await snapshot(page)).guides;
  expect(guides.some((g) => g.kind === 'gap')).toBe(true);
  await page.mouse.up();
  const moved = await node(page, c);
  expect(moved.x - (nb.x + nb.width)).toBeCloseTo(gap, 0);

  // Hold Alt with a layer selected and point at another: the distances appear.
  await select(page, [a]);
  const target = await centerOf(page, c);
  await page.keyboard.down('Alt');
  await page.mouse.move(target.x, target.y);
  await expect(page.locator('.ov-measure').first()).toBeVisible();
  await page.keyboard.up('Alt');
  await expect(page.locator('.ov-measure')).toHaveCount(0);
  expect(await selected(page)).toEqual([a]);
});
