import { join } from 'node:path';
import { test } from '@playwright/test';

/**
 * The README's rendered pictures (docs/presentation/PRESENTATION-BRIEF.md, P5): each HTML page in docs/brand/ is
 * rendered to a PNG in docs/media/ at 2×, through the demo's dev server so the page's paths to the app's tokens and the
 * installed Inter resolve. `npm run demos -- brand` renders only these.
 */

test.use({ deviceScaleFactor: 2, video: 'off' });

const PAGES = [{ name: 'hero', width: 1600, height: 500 }];

for (const { name, width, height } of PAGES) {
  test(`renders docs/brand/${name}.html`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto(`/docs/brand/${name}.html`);
    await page.evaluate(async () => {
      // Both faces are asked for, so neither falls back before the picture is taken.
      await Promise.all([document.fonts.load('500 30px Inter'), document.fonts.load('italic 800 168px Inter')]);
      await document.fonts.ready;
    });
    await page.screenshot({ path: join(process.cwd(), 'docs', 'media', `${name}.png`) });
  });
}
