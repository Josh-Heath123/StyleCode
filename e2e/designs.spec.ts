import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { draw, openFreshProject, snapshot } from './helpers';
import { kickoff } from './karoo';
import { png } from './png';
import { E2E_WORKSPACE } from './workspaceFolder';

/**
 * An engagement's designs (Phase 4, Slice A; decisions 1 to 8): kept in the
 * client's folder with their images, opened in the editor from the
 * engagement, and never mixed with the editor's own designs in this
 * browser. Karoo Freight is role-played.
 */

const designsDir = (companyId: string) => join(E2E_WORKSPACE, 'companies', companyId, 'designs');
const designFiles = (companyId: string) =>
  existsSync(designsDir(companyId))
    ? readdirSync(designsDir(companyId)).filter((n) => /^doc_[a-z0-9]+\.stylecode\.json$/.test(n))
    : [];
const assetFiles = (companyId: string) =>
  existsSync(join(designsDir(companyId), 'assets'))
    ? readdirSync(join(designsDir(companyId), 'assets')).filter((n) => !n.endsWith('.type'))
    : [];
const onDisk = (companyId: string) =>
  JSON.parse(readFileSync(join(E2E_WORKSPACE, 'companies', companyId, 'workspace.json'), 'utf8')) as {
    designs: Record<string, { id: string; name: string; documentId: string }>;
  };
const designFile = (companyId: string, documentId: string) =>
  JSON.parse(readFileSync(join(designsDir(companyId), `${documentId}.stylecode.json`), 'utf8')) as {
    document: { id: string; name: string; nodes: Record<string, { type: string; src?: string }> };
  };

/** What this browser keeps: the editor's own designs and images. */
function browserStore(page: Page): Promise<{ projects: { id: string; file: string }[]; assets: string[] }> {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('stylecode');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(['projects', 'assets']);
          const projects = tx.objectStore('projects').getAll();
          const assets = tx.objectStore('assets').getAllKeys();
          tx.oncomplete = () => {
            resolve({
              projects: (projects.result as { id: string; file: unknown }[]).map((p) => ({
                id: p.id,
                file: JSON.stringify(p.file),
              })),
              assets: assets.result as string[],
            });
            db.close();
          };
        };
      }),
  );
}

const axe = async (page: Page) =>
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations.map((v) => v.id),
  ).toEqual([]);

const card = (page: Page) => page.getByRole('region', { name: 'Designs' });

/** A new design from the engagement page, opened in the editor. */
async function newDesign(page: Page, companyId: string, name: string) {
  await page.goto(`/#/c/${companyId}/e/en_1`);
  await card(page).getByRole('button', { name: 'New design' }).click();
  const dialog = page.getByRole('dialog', { name: 'New design' });
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByRole('button', { name: 'Create and open' }).click();
  await page.waitForSelector('.canvas');
  await expect(page.getByLabel('Design name')).toHaveValue(name);
}

const saved = (page: Page) => expect(page.locator('.save-status')).toHaveText('Saved in the client’s folder');

test('a new design opens from the engagement, saves in the client’s folder, never in this browser, and is there after a reload', async ({
  page,
}) => {
  const id = await kickoff(page);
  await newDesign(page, id, 'Dispatch board');
  await expect(page.getByRole('link', { name: 'Back to the engagement' })).toHaveAttribute('href', `#/c/${id}/e/en_1`);
  const rect = await draw(page, 'r', [500, 300], [640, 400]);
  await saved(page);
  const [link] = Object.values(onDisk(id).designs);
  expect(link.name).toBe('Dispatch board');
  await expect.poll(() => Object.keys(designFile(id, link.documentId).document.nodes)).toContain(rect);
  // Decision 4: a company design is never written to IndexedDB.
  expect((await browserStore(page)).projects.map((p) => p.id)).not.toContain(link.documentId);

  // Closing and reopening StyleCode finds it.
  await page.reload();
  await page.waitForSelector('.canvas');
  await expect.poll(async () => Object.keys((await snapshot(page)).doc.nodes)).toContain(rect);
  await page.getByRole('link', { name: 'Back to the engagement' }).click();
  await expect(card(page).getByRole('listitem').filter({ hasText: 'Dispatch board' })).toBeVisible();
  await axe(page);
});

test('copying one of the editor’s designs leaves the original as it was, and the copy is in the client’s folder with its images; the editor’s designs never reach the client', async ({
  page,
}, testInfo) => {
  const id = await kickoff(page);
  // One of the editor's own designs, with an image.
  await openFreshProject(page);
  const name = page.getByLabel('Design name');
  await name.fill('Brand sketches');
  await name.press('Enter');
  const imagePath = testInfo.outputPath('logo.png');
  writeFileSync(imagePath, png(64, 32, 0x40));
  page.once('filechooser', (chooser) => chooser.setFiles(imagePath));
  await page.keyboard.press('Control+Shift+K');
  await expect.poll(async () => (await snapshot(page)).selection.length).toBe(1);
  await expect(page.locator('.save-status')).toHaveText('Saved on this device');
  const original = (await snapshot(page)).doc;
  const image = Object.values(original.nodes).find((n) => n.type === 'image') as { src: string };
  const before = (await browserStore(page)).projects.find((p) => p.id === original.id);
  expect(before).toBeTruthy();

  await page.goto(`/#/c/${id}/e/en_1`);
  await card(page).getByRole('button', { name: 'Copy one of the editor’s designs…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Copy one of the editor’s designs' });
  await dialog.getByRole('radio', { name: /^Brand sketches/ }).check();
  await axe(page);
  await dialog.getByRole('button', { name: 'Copy into this engagement' }).click();
  await page.waitForSelector('.canvas');
  await expect(page.getByLabel('Design name')).toHaveValue('Brand sketches');

  const [link] = Object.values(onDisk(id).designs);
  expect(link.documentId).not.toBe(original.id);
  expect(Object.values(designFile(id, link.documentId).document.nodes).some((n) => n.src === image.src)).toBe(true);
  expect(assetFiles(id)).toEqual([image.src]);
  // The copy shows its image, from the client's folder.
  await expect(page.locator('.canvas img').first()).toHaveJSProperty('naturalWidth', 64);
  // The original is exactly as it was.
  expect((await browserStore(page)).projects.find((p) => p.id === original.id)).toEqual(before);

  // Decision 4's other rule: the editor's own design, changed now, never reaches the client's folder.
  const files = designFiles(id).map((f) => readFileSync(join(designsDir(id), f), 'utf8'));
  await page.goto('/#/editor');
  await page.waitForSelector('.canvas');
  await expect(page.getByLabel('Design name')).toHaveValue('Brand sketches');
  await draw(page, 'r', [500, 300], [600, 380]);
  await expect(page.locator('.save-status')).toHaveText('Saved on this device');
  expect(designFiles(id).map((f) => readFileSync(join(designsDir(id), f), 'utf8'))).toEqual(files);
});

test('a design open in two tabs: the stale save is refused, and the tab says to reload', async ({ page, context }) => {
  const id = await kickoff(page);
  await newDesign(page, id, 'Two tabs');
  const href = page.url();
  const other = await context.newPage();
  await other.goto(href);
  await other.waitForSelector('.canvas');
  await draw(page, 'r', [500, 300], [600, 380]);
  await saved(page);
  await draw(other, 'r', [700, 300], [800, 380]);
  await expect(other.locator('.save-status')).toHaveText('Not saved');
  await expect(other.getByText('This design changed in another tab. Reload it to carry on.').first()).toBeVisible();
  await other.close();
});

test('deleting the engagement deletes its designs and their images, and the editor closes the design without saving it', async ({
  page,
}, testInfo) => {
  const id = await kickoff(page);
  await newDesign(page, id, 'Gone with the engagement');
  const imagePath = testInfo.outputPath('photo.png');
  writeFileSync(imagePath, png(40, 20, 0x20));
  page.once('filechooser', (chooser) => chooser.setFiles(imagePath));
  await page.keyboard.press('Control+Shift+K');
  await expect.poll(() => assetFiles(id)).toHaveLength(1);
  // Saved with the image layer, so the image is the design's.
  const [link] = Object.values(onDisk(id).designs);
  await expect
    .poll(() => Object.values(designFile(id, link.documentId).document.nodes).some((n) => n.src === assetFiles(id)[0]))
    .toBe(true);
  await page.getByRole('link', { name: 'Back to the engagement' }).click();
  await page.getByRole('button', { name: 'Delete engagement…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete engagement…' });
  await expect(dialog).toContainText('1 design with their images');
  await dialog.getByRole('button', { name: 'Delete engagement' }).click();
  await expect(page).toHaveURL(new RegExp(`#/c/${id}$`));
  await expect.poll(() => designFiles(id)).toEqual([]);
  expect(assetFiles(id)).toEqual([]);
  // The editor let it go: nothing writes it back.
  await page.goto('/#/editor');
  await page.waitForSelector('.canvas');
  await expect(page.getByLabel('Design name')).not.toHaveValue('Gone with the engagement');
  expect(designFiles(id)).toEqual([]);
});

test('a damaged design, and any design of a read-only client, is listed with the reason and a Download, and isn’t opened', async ({
  page,
}) => {
  const id = await kickoff(page);
  await newDesign(page, id, 'Damaged');
  const [link] = Object.values(onDisk(id).designs);
  await page.getByRole('link', { name: 'Back to the engagement' }).click();
  writeFileSync(join(designsDir(id), `${link.documentId}.stylecode.json`), '{ not a design');
  await page.reload();
  const row = card(page).getByRole('listitem').filter({ hasText: 'Damaged' });
  await expect(row).toContainText('Can’t be opened');
  await expect(row.getByRole('link', { name: 'Open “Damaged”' })).toHaveCount(0);
  const download = page.waitForEvent('download');
  await row.getByRole('button', { name: 'Download “Damaged”' }).click();
  expect(readFileSync(await (await download).path(), 'utf8')).toBe('{ not a design');
  await axe(page);
  await page.goto(`/#/c/${id}/e/en_1/d/${link.id}`);
  await expect(page.getByRole('heading', { name: '“Damaged” can’t be opened' })).toBeVisible();
  expect(readFileSync(join(designsDir(id), `${link.documentId}.stylecode.json`), 'utf8')).toBe('{ not a design');

  // A read-only client: its designs are listed with the reason, and not opened.
  const file = join(E2E_WORKSPACE, 'companies', id, 'workspace.json');
  const ws = JSON.parse(readFileSync(file, 'utf8')) as { designs: Record<string, { name: string }> };
  Object.values(ws.designs)[0].name = '';
  writeFileSync(file, JSON.stringify(ws));
  await page.goto(`/#/c/${id}/e/en_1`);
  await page.reload();
  await expect(card(page)).toContainText('This client opens read-only');
  await page.goto(`/#/c/${id}/e/en_1/d/${link.id}`);
  await expect(page.getByRole('alert')).toContainText('This client opens read-only');
});

test('a design never opens under another client’s route', async ({ page }) => {
  const id = await kickoff(page);
  await newDesign(page, id, 'Karoo only');
  const [link] = Object.values(onDisk(id).designs);
  const other = await kickoff(page);
  await page.goto(`/#/c/${other}/e/en_1/d/${link.id}`);
  await expect(page.getByRole('heading', { name: 'There is no such design here' })).toBeVisible();
  await expect(page.locator('.canvas')).toHaveCount(0);
});

test('one name: renaming in the editor renames it on the engagement, and the other way round', async ({ page }) => {
  const id = await kickoff(page);
  await newDesign(page, id, 'First name');
  const name = page.getByLabel('Design name');
  await name.fill('Named in the editor');
  await name.press('Enter');
  await saved(page);
  await expect.poll(() => Object.values(onDisk(id).designs)[0].name).toBe('Named in the editor');
  await page.getByRole('link', { name: 'Back to the engagement' }).click();
  await card(page).getByRole('button', { name: 'Rename “Named in the editor”' }).click();
  const dialog = page.getByRole('dialog', { name: 'Rename design' });
  await dialog.getByLabel('Name').fill('Named on the engagement');
  await dialog.getByRole('button', { name: 'Rename' }).click();
  await expect(card(page)).toContainText('Named on the engagement');
  await card(page).getByRole('link', { name: 'Open “Named on the engagement”' }).click();
  await expect(page.getByLabel('Design name')).toHaveValue('Named on the engagement');
  const [link] = Object.values(onDisk(id).designs);
  await expect.poll(() => designFile(id, link.documentId).document.name).toBe('Named on the engagement');
});

test('Download as file reads the client’s images from its folder; nothing of the design reaches this browser’s storage', async ({
  page,
}, testInfo) => {
  const id = await kickoff(page);
  await newDesign(page, id, 'With a photo');
  const imagePath = testInfo.outputPath('photo.png');
  writeFileSync(imagePath, png(50, 30, 0x60));
  page.once('filechooser', (chooser) => chooser.setFiles(imagePath));
  await page.keyboard.press('Control+Shift+K');
  await saved(page);
  const [link] = Object.values(onDisk(id).designs);
  await expect.poll(() => assetFiles(id)).toHaveLength(1);
  const [assetId] = assetFiles(id);
  // The menu offers only the way back and a file of it.
  await page.getByRole('button', { name: 'Design', exact: true }).click();
  await expect(page.getByRole('menuitem')).toHaveText(['Back to the engagement', 'Download as file…']);
  await page.evaluate(() => delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker);
  const download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Download as file…' }).click();
  const file = JSON.parse(readFileSync(await (await download).path(), 'utf8')) as { assets: Record<string, unknown> };
  expect(Object.keys(file.assets)).toEqual([assetId]);
  const store = await browserStore(page);
  expect(store.projects.map((p) => p.id)).not.toContain(link.documentId);
  expect(store.assets).not.toContain(assetId);
  await axe(page);
});

type Node = { id: string; src?: string };
const selectedNode = async (page: Page) => {
  const s = await snapshot(page);
  return s.doc.nodes[s.selection[0]] as Node;
};

test('pasting: an image comes into a client’s design only from the editor’s own designs, never from another client, and never goes into the editor’s', async ({
  page,
}, testInfo) => {
  const karoo = await kickoff(page);
  const bakery = await kickoff(page);
  const pasteLayer = async () => {
    await page.locator('.canvas').click({ position: { x: 900, y: 600 } });
    await page.keyboard.press('Control+v');
  };
  const addImage = async (file: string, shade: number) => {
    const path = testInfo.outputPath(file);
    writeFileSync(path, png(30, 30, shade));
    page.once('filechooser', (chooser) => chooser.setFiles(path));
    await page.keyboard.press('Control+Shift+K');
    // The new image layer is the one selected (named after its file), not the layer selected before.
    const layer = file.replace(/\.png$/, '');
    await expect.poll(async () => ((await selectedNode(page)) as Node & { name?: string })?.name).toBe(layer);
  };

  // 1. From the editor's own design into a client's: the image is copied into the client.
  await openFreshProject(page);
  await addImage('own.png', 0x11);
  const own = await selectedNode(page);
  await page.keyboard.press('Control+c');
  await newDesign(page, karoo, 'Pasted into');
  await pasteLayer();
  await expect.poll(() => assetFiles(karoo)).toContain(own.src);

  // 2. From one client's design into another's: never copied; a placeholder and a notice.
  await addImage('karoo.png', 0x22);
  const karooImage = await selectedNode(page);
  await page.keyboard.press('Control+c');
  await newDesign(page, bakery, 'Other client');
  await pasteLayer();
  await expect(page.getByText(/couldn’t come with the pasted layers/).first()).toBeVisible();
  expect(assetFiles(bakery)).not.toContain(karooImage.src);

  // 3. From a client's design into the editor's own: nothing goes into this browser's storage.
  await page.goto('/#/editor');
  await page.waitForSelector('.canvas');
  await pasteLayer();
  await expect(page.getByText(/stay with that client/).first()).toBeVisible();
  expect((await browserStore(page)).assets).not.toContain(karooImage.src);
});

test('a layer’s route opens its design with that layer selected', async ({ page }) => {
  const id = await kickoff(page);
  await newDesign(page, id, 'Layer route');
  const rect = await draw(page, 'r', [500, 300], [640, 400]);
  await saved(page);
  const [link] = Object.values(onDisk(id).designs);
  await page.goto(`/#/c/${id}/e/en_1`);
  await page.goto(`/#/c/${id}/e/en_1/d/${link.id}/l/${rect}`);
  await page.waitForSelector('.canvas');
  await expect.poll(async () => (await snapshot(page)).selection).toEqual([rect]);
});

test('if the editor fails to draw a client’s design, the recovery screen offers Download as file only', async ({ page }) => {
  const id = await kickoff(page);
  await newDesign(page, id, 'Breaks');
  await saved(page);
  const [link] = Object.values(onDisk(id).designs);
  const before = readFileSync(join(designsDir(id), `${link.documentId}.stylecode.json`), 'utf8');
  page.on('pageerror', () => {});
  await page.evaluate(() => {
    const editor = (window as unknown as { stylecode: { editor: Record<string, unknown> } }).stylecode.editor as unknown as {
      getState(): { doc: { rootId: string; nodes: Record<string, { children: unknown }> } };
      set(partial: unknown): void;
    };
    const { doc } = editor.getState();
    const frame = (doc.nodes[doc.rootId].children as string[])[0];
    editor.set({ doc: { ...doc, nodes: { ...doc.nodes, [frame]: { ...doc.nodes[frame], children: null } } } });
  });
  const crash = page.getByRole('alert').filter({ hasText: 'StyleCode hit a problem' });
  await expect(crash).toBeVisible();
  await expect(crash.getByRole('button', { name: 'Download as file' })).toBeVisible();
  await expect(crash.getByRole('button', { name: 'Save a copy to a file' })).toHaveCount(0);
  await page.evaluate(() => delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker);
  const download = page.waitForEvent('download');
  await crash.getByRole('button', { name: 'Download as file' }).click();
  await download;
  await expect(crash).toContainText('The last good save is still in the client’s folder.');
  // The broken design wasn't saved over the last good one, and nothing reached this browser's storage.
  expect(readFileSync(join(designsDir(id), `${link.documentId}.stylecode.json`), 'utf8')).toBe(before);
  expect((await browserStore(page)).projects.map((p) => p.id)).not.toContain(link.documentId);
});
