import { expect, test } from '@playwright/test';
import { snapshot } from './helpers';

/**
 * A 5,000-layer document stays usable. The timings are generous limits that
 * catch something going badly wrong (work repeated for every layer), not a
 * benchmark: `src/model/performance.test.ts` has the tighter budgets.
 */

test.setTimeout(90_000);

test('a 5,000-layer document loads, lists, scrolls and drags', async ({ page }) => {
  await page.goto('/#/editor');
  await page.waitForSelector('.canvas');

  const loadMs = await page.evaluate(async () => {
    // Built with the app's own modules, served by the dev server.
    const { createNode } = await import(/* @vite-ignore */ '/src/model/defaults.ts' as string);
    const { createDocument } = await import(/* @vite-ignore */ '/src/model/document.ts' as string);
    const doc = createDocument('Big');
    const nodes = { ...doc.nodes };
    const add = (parentId: string, node: { id: string }) => {
      nodes[node.id] = { ...node, parentId, children: [] };
      nodes[parentId] = { ...nodes[parentId], children: [...nodes[parentId].children, node.id] };
      return node.id;
    };
    const pad = { paddingTop: 16, paddingRight: 16, paddingBottom: 16, paddingLeft: 16 };
    for (let p = 0; p < 10; p++) {
      const pageId = add(
        doc.rootId,
        createNode('frame', {
          name: `Page ${p + 1}`,
          x: p * 1600,
          width: 1440,
          height: 900,
          layout: 'column',
          gap: 24,
          heightMode: 'hug',
          ...pad,
        }),
      );
      for (let s = 0; s < 20; s++) {
        const section = add(
          pageId,
          createNode('frame', { name: `Section ${s + 1}`, layout: 'row', gap: 16, widthMode: 'fill', heightMode: 'hug', ...pad }),
        );
        for (let c = 0; c < 4; c++) {
          const card = add(
            section,
            createNode('frame', {
              name: `Card ${c + 1}`,
              layout: 'column',
              gap: 8,
              widthMode: 'fill',
              heightMode: 'hug',
              ...pad,
            }),
          );
          add(card, createNode('rect', { height: 120, widthMode: 'fill' }));
          add(
            card,
            createNode('text', { text: `Card ${p}-${s}-${c}`, fontSize: 18, textResize: 'auto-height', widthMode: 'fill' }),
          );
          add(
            card,
            createNode('text', { text: 'A short description that wraps.', textResize: 'auto-height', widthMode: 'fill' }),
          );
          const button = add(card, createNode('frame', { layout: 'row', widthMode: 'hug', heightMode: 'hug', ...pad }));
          add(button, createNode('text', { text: 'Open' }));
        }
      }
    }
    const editor = (window as unknown as { stylecode: { editor: { loadDocument(d: unknown): void } } }).stylecode.editor;
    const start = performance.now();
    editor.loadDocument({ ...doc, nodes });
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    return performance.now() - start;
  });
  expect(Object.keys((await snapshot(page)).doc.nodes)).toHaveLength(5011);
  expect(loadMs).toBeLessThan(15_000);

  // The layer list only draws the rows in view.
  expect(await page.locator('.layer-row').count()).toBeLessThan(120);
  // Pages out of view aren't drawn.
  const skipped = await page
    .locator('.canvas-content > .sc-frame')
    .evaluateAll((els) => els.filter((el) => getComputedStyle(el).contentVisibility === 'auto').length);
  expect(skipped).toBe(10);

  // Zoom to the first page, then drag a card along its row.
  const snap = await snapshot(page);
  const firstPage = snap.doc.nodes[snap.doc.rootId].children[0];
  const card = snap.doc.nodes[snap.doc.nodes[firstPage].children[1]].children[1];
  await page.evaluate(
    (id) => (window as unknown as { stylecode: { editor: { select(ids: string[]): void } } }).stylecode.editor.select([id]),
    firstPage,
  );
  await page.keyboard.press('Shift+2');
  await page.evaluate(
    (id) => (window as unknown as { stylecode: { editor: { select(ids: string[]): void } } }).stylecode.editor.select([id]),
    card,
  );
  const box = (await page.locator(`[data-node-id="${card}"]`).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 10);
  await page.mouse.down();
  const start = Date.now();
  for (let i = 1; i <= 20; i++) await page.mouse.move(box.x + box.width / 2 + i * 8, box.y + 10);
  const perMove = (Date.now() - start) / 20;
  await page.mouse.up();
  expect(perMove).toBeLessThan(400);
  expect((await snapshot(page)).doc.nodes[card].parentId).toBe(snap.doc.nodes[card].parentId);
});
