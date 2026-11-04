import { expect, test, type Page } from '@playwright/test';
import { unzip } from '../src/codegen/zip';
import { findByName, node, openFreshProject, select, snapshot } from './helpers';

/** Opens the example project, optionally tidied into auto layout, and returns the landing page's id. */
async function example(page: Page, tidy: boolean): Promise<string> {
  await page.getByRole('button', { name: 'Projects' }).click();
  await page.getByRole('menuitem', { name: 'New example project' }).click();
  await expect.poll(async () => findByName(await snapshot(page), 'Navigation')).toBeTruthy();
  const landing = findByName(await snapshot(page), 'Landing page')!;
  if (tidy) {
    await select(page, [landing.id]);
    await page.keyboard.press('Shift+A');
  }
  return landing.id;
}

/**
 * Renders a screen's exported HTML in a fresh page at a given width and
 * returns, for every layer, where the browser put it relative to the screen.
 */
async function renderExport(page: Page, screenId: string, width: number) {
  const { html, classes } = await page.evaluate(async (id) => {
    const load = (path: string): Promise<any> => import(/* @vite-ignore */ path);
    const { previewDocument } = await load('/src/app/codeExport.ts');
    const { buildScreen } = await load('/src/codegen/screen.ts');
    const editor = (window as any).stylecode.editor;
    const doc = editor.getState().doc;
    const screen = buildScreen(doc, id);
    const classes = Object.fromEntries(screen.rules.filter((r: any) => !r.pseudo).map((r: any) => [r.className, r.nodeId]));
    return { html: (await previewDocument(doc, id)).html as string, classes: classes as Record<string, string> };
  }, screenId);
  const view = await page.context().newPage();
  await view.setViewportSize({ width, height: 900 });
  await view.setContent(html);
  await view.evaluate(() => document.fonts.ready);
  const boxes = await view.evaluate((map) => {
    const root = document.body.firstElementChild!.getBoundingClientRect();
    const out: Record<string, { x: number; y: number; width: number; height: number }> = {};
    for (const [cls, id] of Object.entries(map)) {
      const el = document.querySelector(`.${CSS.escape(cls)}`);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      out[id] = { x: r.left - root.left, y: r.top - root.top, width: r.width, height: r.height };
    }
    return {
      out,
      scrollWidth: document.documentElement.scrollWidth,
    };
  }, classes);
  await view.close();
  return boxes;
}

/** Each layer's box relative to its screen, from the model (unrotated layers only). */
async function modelBoxes(page: Page, screenId: string) {
  return page.evaluate((id) => {
    const editor = (window as any).stylecode.editor;
    const doc = editor.getState().doc;
    const out: Record<string, { x: number; y: number; width: number; height: number }> = {};
    const visit = (nodeId: string, x: number, y: number, rotated: boolean) => {
      const n = doc.nodes[nodeId];
      if (!n.visible) return;
      const isRoot = nodeId === id;
      const nx = isRoot ? 0 : x + n.x;
      const ny = isRoot ? 0 : y + n.y;
      const turned = rotated || (!isRoot && n.rotation !== 0);
      if (!turned) out[nodeId] = { x: nx, y: ny, width: n.width, height: n.height };
      const inset = n.stroke && n.strokeWidth > 0 && n.type !== 'text' ? n.strokeWidth : 0;
      for (const c of n.children) visit(c, nx + inset, ny + inset, turned);
    };
    visit(id, 0, 0, false);
    return out;
  }, screenId);
}

test.describe('exported code', () => {
  for (const tidy of [true, false]) {
    test(`matches the canvas at the design width (${tidy ? 'auto layout' : 'free layout'})`, async ({ page }) => {
      await openFreshProject(page);
      const id = await example(page, tidy);
      const width = (await node(page, id)).width;
      const [browser, model] = await Promise.all([renderExport(page, id, width), modelBoxes(page, id)]);
      const off: string[] = [];
      for (const [nodeId, m] of Object.entries(model)) {
        const b = browser.out[nodeId];
        if (!b) continue;
        for (const key of ['x', 'y', 'width', 'height'] as const) {
          if (Math.abs(b[key] - m[key]) > 1)
            off.push(`${nodeId} ${key}: browser ${b[key].toFixed(1)} vs canvas ${m[key].toFixed(1)}`);
        }
      }
      expect(Object.keys(browser.out).length).toBeGreaterThan(20);
      expect(off).toEqual([]);
    });
  }

  test('fits a phone screen without sideways scrolling once tidied', async ({ page }) => {
    await openFreshProject(page);
    const id = await example(page, true);
    for (const width of [390, 768]) {
      expect((await renderExport(page, id, width)).scrollWidth).toBeLessThanOrEqual(width);
    }
  });
});

test.describe('code panel', () => {
  test.beforeEach(async ({ page }) => openFreshProject(page));

  test('highlights the selected layer and edits it through CSS', async ({ page }) => {
    await example(page, true);
    const card = findByName(await snapshot(page), 'Shared by default card')!;
    await page.getByRole('tab', { name: 'Code' }).click();
    await select(page, [card.id]);
    const highlighted = page.locator('.code-line.is-on');
    await expect(highlighted.first()).toContainText('class="shared-by-default-card"');

    const css = page.getByLabel(`CSS for ${card.name}`);
    const text = await css.inputValue();
    expect(text).toContain('border-radius: 16px;');
    await css.fill(text.replace('border-radius: 16px;', 'border-radius: 4px;\nbox-shadow: 0px 4px 12px 0px #00000040;'));
    await css.press('Control+Enter');
    expect(await node(page, card.id)).toMatchObject({ radius: 4, shadowColor: '#00000040', shadowY: 4, shadowBlur: 12 });
    await page.getByRole('tab', { name: 'landing-page.css' }).click();
    await expect(page.locator('.code-line.is-on', { hasText: 'border-radius: 4px;' })).toHaveCount(1);

    // One undo step brings the design back.
    await page.locator('.canvas').click({ position: { x: 5, y: 5 } });
    await select(page, [card.id]);
    await page.keyboard.press('Control+z');
    expect((await node(page, card.id)).radius).toBe(16);

    // CSS StyleCode can't represent is reported, and nothing changes.
    await css.fill('filter: blur(4px);');
    await css.press('Control+Enter');
    await expect(page.locator('.layer-css-errors')).toContainText('filter isn’t supported yet');
    expect((await node(page, card.id)).radius).toBe(16);
  });

  test('keeps working when the screen it shows is hidden', async ({ page }) => {
    const id = await example(page, false);
    await page.getByRole('tab', { name: 'Code' }).click();
    await select(page, [id]);
    await page.keyboard.press('Control+Shift+H');
    expect((await node(page, id)).visible).toBe(false);
    await expect(page.locator('.code-panel, .panel-empty').first()).toBeVisible();
    await expect(page.locator('.canvas')).toBeVisible();
  });

  test('clicking a line of code selects its layer', async ({ page }) => {
    await example(page, true);
    await page.getByRole('tab', { name: 'Code' }).click();
    await page.locator('.code-line', { hasText: 'class="headline"' }).click();
    const [selected] = (await snapshot(page)).selection;
    expect((await node(page, selected)).name).toBe('Headline');
  });

  test('previews the page at phone width', async ({ page }) => {
    await example(page, true);
    await page.getByRole('button', { name: 'Preview', exact: true }).first().click();
    const frame = page.locator('.preview iframe');
    await expect(frame).toHaveAttribute('sandbox', '');
    await expect(frame).toHaveCSS('width', '1440px');
    await page.getByRole('radio', { name: /Mobile/ }).click();
    await expect(frame).toHaveCSS('width', '390px');
    await expect(page.frameLocator('.preview iframe').getByText('Research notes that')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.preview')).toHaveCount(0);
  });

  test('exports a website and a React app as ZIP files', async ({ page }) => {
    await example(page, true);
    // Use the download fallback rather than the system save dialog.
    await page.evaluate(() => delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker);
    for (const [label, expected] of [
      ['Website (HTML and CSS)…', ['example-landing-page-site/index.html', 'example-landing-page-site/base.css']],
      [
        'React app (Vite + TypeScript)…',
        ['example-landing-page-react/package.json', 'example-landing-page-react/src/screens/LandingPage.tsx'],
      ],
    ] as const) {
      await page.getByRole('button', { name: 'Export code' }).click();
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: label }).click()]);
      const path = await download.path();
      const { readFileSync } = await import('node:fs');
      const files = unzip(new Uint8Array(readFileSync(path!))).map((f) => f.path);
      for (const file of expected) expect(files).toContain(file);
      expect(files.some((f) => f.endsWith('inter-latin-wght-normal.woff2'))).toBe(true);
    }
  });
});
