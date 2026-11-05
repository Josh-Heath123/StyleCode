import { expect, test, type Page } from '@playwright/test';
import { draw, openFreshProject, snapshot } from './helpers';

/** When things go wrong: damaged projects, failed saves, closing too soon, and a crash. */

const saveStatus = (page: Page) => page.locator('.save-status');

test('a damaged project is skipped on start-up and its data can still be downloaded', async ({ page }) => {
  await openFreshProject(page);
  await expect(saveStatus(page)).toHaveText('Saved on this device');
  // Damage the stored project the editor would open next.
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('stylecode');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const tx = db.transaction('projects', 'readwrite');
    tx.objectStore('projects').put({
      id: 'doc_damaged',
      name: 'Damaged project',
      updatedAt: Date.now() + 1000,
      file: { format: 'stylecode', version: 4, document: { nodes: 'not layers' } },
    });
    await new Promise((resolve) => (tx.oncomplete = resolve));
    localStorage.setItem('stylecode:last-project', 'doc_damaged');
  });
  await page.reload();
  await expect(page.locator('.notice')).toContainText('“Damaged project” couldn’t be opened');
  expect((await snapshot(page)).doc.id).not.toBe('doc_damaged');

  await page.getByRole('button', { name: 'Designs' }).click();
  await page.getByRole('menuitem', { name: /All designs/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Designs' });
  await expect(dialog).toContainText('Can’t be opened: The design has no layers.');
  // Use the download fallback rather than the system save dialog.
  await page.evaluate(() => delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Download data' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('Damaged-project-data.json');
  await expect(dialog).toContainText(/Using .* of the .* this browser allows/);
});

test('a failed save says so, offers ways out, and saves when tried again', async ({ page }) => {
  await openFreshProject(page);
  // Make the browser refuse to store anything, as when its storage is full.
  await page.evaluate(() => {
    const proto = IDBObjectStore.prototype as unknown as { put: unknown; realPut?: unknown };
    proto.realPut = proto.put;
    proto.put = () => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    };
  });
  await draw(page, 'r', [420, 300], [560, 400]);
  await expect(page.locator('.notice')).toContainText('Browser storage is full');
  await expect(saveStatus(page)).toContainText('Not saved');

  await page.evaluate(() => {
    const proto = IDBObjectStore.prototype as unknown as { put: unknown; realPut?: unknown };
    proto.put = proto.realPut;
  });
  await saveStatus(page).click();
  await expect(page.getByRole('menuitem', { name: 'Save to file…' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Free up space in Designs…' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Try saving again' }).click();
  await expect(saveStatus(page)).toHaveText('Saved on this device');
});

test('closing the page before a change is saved asks first', async ({ page }) => {
  await openFreshProject(page);
  await expect(saveStatus(page)).toHaveText('Saved on this device');
  await draw(page, 'r', [420, 300], [560, 400]);
  const asked: string[] = [];
  page.on('dialog', (dialog) => {
    asked.push(dialog.type());
    void dialog.dismiss();
  });
  await page.close({ runBeforeUnload: true });
  await expect.poll(() => asked).toEqual(['beforeunload']);
  // Staying on the page: the change then saves as usual.
  expect(page.isClosed()).toBe(false);
  await expect(saveStatus(page)).toHaveText('Saved on this device');
});

test('if the editor fails to draw, the crash screen keeps the work reachable', async ({ page }) => {
  await openFreshProject(page);
  page.on('pageerror', () => {});
  await page.evaluate(() => {
    const editor = (window as unknown as { stylecode: { editor: Record<string, unknown> } }).stylecode.editor as unknown as {
      getState(): { doc: { rootId: string; nodes: Record<string, { children: unknown }> } };
      set(partial: unknown): void;
    };
    const { doc } = editor.getState();
    const frame = (doc.nodes[doc.rootId].children as string[])[0];
    // A layer whose children can't be read: drawing it throws.
    editor.set({ doc: { ...doc, nodes: { ...doc.nodes, [frame]: { ...doc.nodes[frame], children: null } } } });
  });
  const crash = page.getByRole('alert').filter({ hasText: 'StyleCode hit a problem' });
  await expect(crash).toBeVisible();
  await expect(crash.getByRole('button', { name: 'Save a copy to a file' })).toBeVisible();
  await expect(crash.getByRole('button', { name: 'Reload' })).toBeVisible();
  await expect(crash.getByRole('link', { name: 'Report the problem' })).toHaveAttribute('href', /issues\/new\?title=Crash/);
});
