import { expect, type Page } from '@playwright/test';
import type { DesignDocument, DesignNode } from '../src/model/types';

/** What the tests read back from the running editor (exposed by the dev build as `window.stylecode`). */
export interface EditorSnapshot {
  selection: string[];
  doc: DesignDocument;
  guides: { kind: string }[];
  camera: { x: number; y: number; zoom: number };
}

export async function openFreshProject(page: Page): Promise<void> {
  await page.goto('/#/editor');
  await page.waitForSelector('.canvas');
  await page.getByRole('button', { name: 'Designs' }).click();
  await page.getByRole('menuitem', { name: 'New design', exact: true }).click();
  await expect.poll(async () => Object.keys((await snapshot(page)).doc.nodes).length).toBe(2);
}

export function snapshot(page: Page): Promise<EditorSnapshot> {
  return page.evaluate(() => {
    const s = (
      window as unknown as { stylecode: { editor: { getState(): Record<string, unknown> } } }
    ).stylecode.editor.getState();
    return JSON.parse(JSON.stringify({ selection: s.selection, doc: s.doc, guides: s.guides, camera: s.camera }));
  });
}

export async function node(page: Page, id: string): Promise<DesignNode> {
  return (await snapshot(page)).doc.nodes[id];
}

export async function selected(page: Page): Promise<string[]> {
  return (await snapshot(page)).selection;
}

/** Draws a shape with a tool key by dragging between two screen points; returns the new layer's id. */
export async function draw(page: Page, key: string, from: [number, number], to: [number, number]): Promise<string> {
  await page.keyboard.press(key);
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move(to[0], to[1], { steps: 5 });
  await page.mouse.up();
  return (await selected(page))[0];
}

export async function select(page: Page, ids: string[]): Promise<void> {
  await page.evaluate(
    (list) => (window as unknown as { stylecode: { editor: { select(ids: string[]): void } } }).stylecode.editor.select(list),
    ids,
  );
}

export async function centerOf(page: Page, id: string): Promise<{ x: number; y: number }> {
  const box = await page.locator(`[data-node-id="${id}"]`).boundingBox();
  if (!box) throw new Error(`Layer ${id} is not on screen`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function dragBy(page: Page, from: { x: number; y: number }, dx: number, dy: number): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 8 });
  await page.mouse.up();
}

export function findByName(snap: EditorSnapshot, name: string): DesignNode | undefined {
  return Object.values(snap.doc.nodes).find((n) => n.name === name);
}
