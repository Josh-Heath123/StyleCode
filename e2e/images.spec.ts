import { expect, test } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { SCHEMA_VERSION } from '../src/model/serialize';
import { openFreshProject, snapshot } from './helpers';

/** A small solid-colour PNG, generated so the test needs no fixture files. */
function png(width: number, height: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x80)]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

test('adds an image, saves it inside the project file and restores it on open', async ({ page }, testInfo) => {
  await openFreshProject(page);
  const imagePath = testInfo.outputPath('photo.png');
  writeFileSync(imagePath, png(640, 400));

  page.once('filechooser', (chooser) => chooser.setFiles(imagePath));
  await page.keyboard.press('Control+Shift+K');
  await expect.poll(async () => (await snapshot(page)).selection.length).toBe(1);
  const snap = await snapshot(page);
  const image = snap.doc.nodes[snap.selection[0]];
  expect(image).toMatchObject({ type: 'image', width: 480, height: 300 });
  await expect(page.locator(`[data-node-id="${image.id}"] img`)).toHaveJSProperty('naturalWidth', 640);

  // Save to a file (headless Chromium has no save dialog, so the download path is used).
  await page.evaluate(() => ((window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker = undefined));
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Projects' }).click();
  await page.getByRole('menuitem', { name: 'Save to file…' }).click();
  const download = await downloadPromise;
  const filePath = testInfo.outputPath('project.stylecode.json');
  await download.saveAs(filePath);
  const file = JSON.parse(readFileSync(filePath, 'utf8'));
  expect(file.version).toBe(SCHEMA_VERSION);
  expect(file.assets[image.src].type).toBe('image/png');

  // Forget every stored image, then open the file: the picture comes back from the file itself.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const request = indexedDB.open('stylecode');
        request.onsuccess = () => {
          const tx = request.result.transaction('assets', 'readwrite');
          tx.objectStore('assets').clear();
          tx.oncomplete = () => {
            request.result.close();
            resolve();
          };
        };
      }),
  );
  page.once('filechooser', (chooser) => chooser.setFiles(filePath));
  await page.getByRole('button', { name: 'Projects' }).click();
  await page.getByRole('menuitem', { name: 'Open project file…' }).click();
  await expect.poll(async () => Object.values((await snapshot(page)).doc.nodes).some((n) => n.type === 'image')).toBe(true);
  const reopened = Object.values((await snapshot(page)).doc.nodes).find((n) => n.type === 'image')!;
  await expect(page.locator(`[data-node-id="${reopened.id}"] img`)).toHaveJSProperty('naturalWidth', 640);
});
