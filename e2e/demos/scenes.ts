import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';
import type { FakeOllama, FakeReply } from '../fakeOllama';
import { snapshot } from '../helpers';
import { demoOverlay } from './overlay';

/** Shared by the demo recordings and the README screenshot. */

const OUT = join(process.cwd(), 'docs', 'media');
export const SCRIPTED_MODEL = 'scripted-demo-model';

/** Points the app at the scripted model. */
export async function useScriptedModel(page: Page, fake: FakeOllama): Promise<void> {
  await page.request.put('/api/ai/config', {
    headers: { 'x-stylecode-ai': '1' },
    data: { provider: 'ollama', providers: { ollama: { baseUrl: fake.url, model: SCRIPTED_MODEL, contextSize: 8192 } } },
  });
  await page.evaluate(() => (window as any).stylecode.assistant.refresh());
}

/** Answers "do what the note says" by following the note: a blue card with white text. */
export function scriptedReply(body: FakeOllama['requests'][number]): FakeReply {
  const first = body.messages.find((m) => m.role === 'user')?.content ?? '';
  const marked = [...first.matchAll(/^( *)\* (e\d+) (\w+)/gm)].map((m) => ({ id: m[2], type: m[3] }));
  const card = marked[0]?.id ?? 'e1';
  const operations = [
    { op: 'update', id: card, set: { fill: '#2f7bff', strokeWidth: 0 } },
    ...marked.filter((m) => m.type === 'text').map((m) => ({ op: 'update', id: m.id, set: { fill: '#ffffff' } })),
    ...marked.filter((m) => m.type === 'ellipse').map((m) => ({ op: 'update', id: m.id, set: { fill: '#ffa05c' } })),
  ];
  return {
    text: JSON.stringify({
      explanation:
        'Following your note: the card now has the brand blue background, with white text and a cantaloupe icon so it stands out from the other two.',
      operations,
    }),
    delay: 35,
  };
}

// ---------------------------------------------------------------------------
// Helpers: a visible pointer that glides, and pauses a viewer can follow
// ---------------------------------------------------------------------------

const pointer = { x: 640, y: 400 };

export async function glide(page: Page, x: number, y: number, steps = 18): Promise<void> {
  await page.mouse.move(x, y, { steps });
  pointer.x = x;
  pointer.y = y;
}

export async function clickAt(
  page: Page,
  x: number,
  y: number,
  options: { modifiers?: ('Control' | 'Shift')[] } = {},
): Promise<void> {
  await glide(page, x, y);
  await page.waitForTimeout(120);
  for (const key of options.modifiers ?? []) await page.keyboard.down(key);
  await page.mouse.down();
  await page.mouse.up();
  for (const key of options.modifiers ?? []) await page.keyboard.up(key);
}

export async function clickLocator(page: Page, selector: ReturnType<Page['locator']>): Promise<void> {
  const box = (await selector.boundingBox())!;
  await clickAt(page, box.x + box.width / 2, box.y + box.height / 2);
}

export async function box(page: Page, id: string) {
  return (await page.locator(`[data-node-id="${id}"]`).boundingBox())!;
}

export const pause = (page: Page, ms: number) => page.waitForTimeout(ms);

export async function exampleProject(page: Page, tidy: boolean) {
  await page.addInitScript(demoOverlay);
  await page.goto('/#/editor');
  await page.waitForSelector('.canvas');
  await page.getByRole('button', { name: 'Projects' }).click();
  await page.getByRole('menuitem', { name: 'New example project' }).click();
  await expect.poll(async () => Object.keys((await snapshot(page)).doc.nodes).length).toBeGreaterThan(10);
  const find = async (name: string) => Object.values((await snapshot(page)).doc.nodes).find((n) => n.name === name)!.id;
  const landing = await find('Landing page');
  if (tidy) {
    await page.evaluate((id) => (window as any).stylecode.editor.select([id]), landing);
    await page.keyboard.press('Shift+A');
    // The page grows with its content, so nothing that moves down gets cut off at the bottom.
    await page.evaluate(
      (id) => (window as any).stylecode.editor.apply([{ type: 'update', id, props: { heightMode: 'hug' } }], { label: 'Hug' }),
      landing,
    );
    await page.keyboard.press('Escape');
  }
  await glide(page, 1000, 600, 1);
  return { find, landing };
}

/** Zooms in on a layer, a little above centre, so it reads well in a small GIF. */
export async function focusOn(page: Page, id: string, zoom: number, dy = 0): Promise<void> {
  await page.evaluate(
    ([id, zoom, dy]) => {
      const editor = (window as any).stylecode.editor;
      const el = document.querySelector(`[data-node-id="${id}"]`)!.getBoundingClientRect();
      const canvas = document.querySelector('.canvas')!.getBoundingClientRect();
      const camera = editor.getState().camera;
      // The layer's centre in world units, from where it is on screen now.
      const wx = (el.left + el.width / 2 - canvas.left - camera.x) / camera.zoom;
      const wy = (el.top + el.height / 2 - canvas.top - camera.y) / camera.zoom;
      editor.setCamera({ zoom, x: canvas.width / 2 - wx * zoom, y: canvas.height / 2 - wy * zoom + Number(dy) });
    },
    [id, zoom, dy] as const,
  );
}

/** Turns the page's recording into a GIF, starting where the scene starts. */
export async function saveGif(page: Page, name: string, startedAt: number, sceneStart: number): Promise<void> {
  const video = page.video();
  await page.close();
  const path = await video!.path();
  mkdirSync(OUT, { recursive: true });
  const filters =
    'fps=10,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=112:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle';
  try {
    execFileSync('ffmpeg', [
      '-y',
      '-v',
      'error',
      '-ss',
      ((sceneStart - startedAt) / 1000).toFixed(2),
      '-i',
      path,
      '-vf',
      filters,
      '-loop',
      '0',
      join(OUT, `${name}.gif`),
    ]);
  } catch (error) {
    throw new Error(`Recording ${name} needs ffmpeg on the PATH: ${(error as Error).message}`);
  }
}
