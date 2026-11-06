import { expect, test } from '@playwright/test';
import { centerOf, draw, findByName, node, openFreshProject, select, snapshot } from './helpers';

test.beforeEach(async ({ page }) => openFreshProject(page));

test('Shift+A wraps rough shapes in a row, drag and arrow keys reorder it', async ({ page }) => {
  const a = await draw(page, 'r', [400, 300], [450, 340]);
  const b = await draw(page, 'r', [480, 305], [530, 345]);
  const c = await draw(page, 'r', [562, 298], [612, 338]);
  await select(page, [a, b, c]);
  await page.keyboard.press('Shift+A');

  const [rowId] = (await snapshot(page)).selection;
  const row = await node(page, rowId);
  expect(row).toMatchObject({ layout: 'row', widthMode: 'hug', heightMode: 'hug' });
  expect(row.children).toEqual([a, b, c]);

  // Drag the first shape past the last one: the row reorders and shows where it will land.
  await page.keyboard.press('Escape');
  const from = await centerOf(page, a);
  const to = await centerOf(page, c);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x + 20, to.y, { steps: 10 });
  expect((await snapshot(page)).guides.map((g) => g.kind)).toEqual(['insert']);
  await page.mouse.up();
  expect((await node(page, rowId)).children).toEqual([b, c, a]);

  await page.keyboard.press('ArrowLeft');
  expect((await node(page, rowId)).children).toEqual([b, a, c]);
});

test('tidies the example landing page into rows and columns without moving much', async ({ page }) => {
  await page.getByRole('button', { name: 'Designs' }).click();
  await page.getByRole('menuitem', { name: 'New example design' }).click();
  await expect.poll(async () => findByName(await snapshot(page), 'Navigation')).toBeTruthy();

  const before = await snapshot(page);
  const landing = findByName(before, 'Landing page')!;
  await select(page, [landing.id]);
  await page.keyboard.press('Shift+A');

  const after = await snapshot(page);
  const page0 = after.doc.nodes[landing.id];
  expect(page0.layout).toBe('column');
  const nav = findByName(after, 'Navigation')!;
  expect(nav).toMatchObject({ layout: 'row', justify: 'space-between', align: 'center' });
  // The headline keeps its place to within a few pixels.
  const headline = (s: typeof after) => findByName(s, 'Headline')!;
  const world = (s: typeof after, id: string) => {
    let x = 0;
    let y = 0;
    for (let n = s.doc.nodes[id]; n.parentId; n = s.doc.nodes[n.parentId]) {
      x += n.x;
      y += n.y;
    }
    return { x, y };
  };
  const p1 = world(before, headline(before).id);
  const p2 = world(after, headline(after).id);
  expect(Math.abs(p1.x - p2.x)).toBeLessThan(4);
  expect(Math.abs(p1.y - p2.y)).toBeLessThan(4);
});

test('snaps a moved layer to a neighbour and shows a guide', async ({ page }) => {
  // Same width, so centres and edges all line up at once when it snaps.
  const a = await draw(page, 'r', [400, 300], [450, 340]);
  const b = await draw(page, 'r', [600, 500], [650, 540]);
  const from = await centerOf(page, b);
  const target = await centerOf(page, a);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // Drop b so its centre is 3px right of a's centre: close enough to snap.
  await page.mouse.move(target.x + 3, from.y + 40, { steps: 8 });
  expect((await snapshot(page)).guides.some((g) => g.kind === 'snap')).toBe(true);
  await page.mouse.up();
  const na = await node(page, a);
  const nb = await node(page, b);
  expect(nb.x + nb.width / 2).toBeCloseTo(na.x + na.width / 2, 1);
});

test('inserts blocks from the Insert tab with working auto-layout', async ({ page }) => {
  await page.getByRole('tab', { name: 'Insert' }).click();
  await page.getByRole('button', { name: 'Insert Card' }).click();
  const snap = await snapshot(page);
  const card = snap.doc.nodes[snap.selection[0]];
  expect(card).toMatchObject({ name: 'Card', role: 'card', layout: 'column', width: 320 });
  const kids = card.children.map((id) => snap.doc.nodes[id]);
  // Children stretch to the card's inner width (320 - 2 border - 32 padding).
  expect(kids[0].width).toBe(286);
  expect(kids[1].y).toBeGreaterThan(kids[0].y + kids[0].height);

  // Changing the card's padding re-flows its children in the same undo step.
  await page.getByLabel('Padding left').fill('40');
  await page.getByLabel('Padding left').press('Enter');
  expect((await node(page, kids[0].id)).x).toBe(40);
  await page.keyboard.press('Control+z');
  expect((await node(page, kids[0].id)).x).toBe(16);
});

test('the layers list shows a row in reading order and reorders it by dragging', async ({ page }) => {
  const a = await draw(page, 'r', [400, 300], [450, 340]);
  const b = await draw(page, 'r', [480, 300], [530, 340]);
  const c = await draw(page, 'r', [560, 300], [610, 340]);
  await select(page, [a, b, c]);
  await page.keyboard.press('Shift+A');
  const [rowId] = (await snapshot(page)).selection;
  await select(page, [a]); // reveals the row's children in the list

  const names = async () => page.locator('.layer-row[aria-level="3"] .layer-name').allInnerTexts();
  const snap = await snapshot(page);
  const label = (id: string) => snap.doc.nodes[id].name;
  // First in the row is listed first (outside auto layout the front-most layer is on top).
  expect(await names()).toEqual([a, b, c].map(label));

  // Drag the first row of the list below the last one.
  const rows = page.locator('.layer-row[aria-level="3"]');
  const first = (await rows.nth(0).boundingBox())!;
  const last = (await rows.nth(2).boundingBox())!;
  await page.mouse.move(first.x + 60, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.x + 60, last.y + last.height * 0.9, { steps: 8 });
  await page.mouse.up();
  expect((await node(page, rowId)).children).toEqual([b, c, a]);
  expect(await names()).toEqual([b, c, a].map(label));
});
