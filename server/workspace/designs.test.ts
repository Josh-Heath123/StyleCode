import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNode } from '../../src/model/defaults';
import { createDocument } from '../../src/model/document';
import { applyOps } from '../../src/model/ops';
import { toProjectFile } from '../../src/model/serialize';
import type { CompanyWorkspace } from '../../src/workspace/model/index.ts';
import { assetIdOf, DesignFiles } from './designs.ts';
import { WorkspaceStore } from './store.ts';

/**
 * Designs and their images in the company's folder (Phase 4 brief, WP2;
 * decisions 2, 3, 6 and 8). Every client is role-played.
 */

let root: string;
let store: WorkspaceStore;
let designs: DesignFiles;
let now = new Date('2026-11-18T09:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'stylecode-designs-'));
  mkdirSync(join(root, 'companies'));
  now = new Date('2026-11-18T09:00:00.000Z');
  store = new WorkspaceStore(root, { now: () => now, retry: { attempts: 2, delayMs: 1 } });
  designs = new DesignFiles(store, { now: () => now, retry: { attempts: 2, delayMs: 1 } });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a0f60000000049454e44ae426082',
  'hex',
);
const OTHER_PNG = Buffer.concat([PNG, Buffer.from([0])]);

/** A design file for `documentId`, with an image layer for each asset id given. */
function designFile(documentId: string, name = 'Checkout', assets: string[] = []) {
  let doc = { ...createDocument(name), id: documentId };
  const nodes = assets.map((src, i) => createNode('image', { name: `Image ${i + 1}`, src, width: 10, height: 10 }));
  for (const node of nodes) doc = applyOps(doc, [{ type: 'create', parentId: doc.rootId, index: 0, nodes: [node] }]).doc;
  return toProjectFile(doc);
}

/** A client with an engagement, and these documents listed as its designs. */
async function client(name: string, documentIds: string[] = []) {
  const opened = await store.create({ name });
  const id = opened.workspace.company.id;
  const ws = withDesigns(opened.workspace, documentIds);
  const saved = await store.save(id, ws, opened.revision, false);
  return { id, ws, revision: saved.revision };
}

function withDesigns(ws: CompanyWorkspace, documentIds: string[]): CompanyWorkspace {
  const at = ws.company.createdAt;
  return {
    ...ws,
    engagements: {
      en_1: {
        id: 'en_1',
        companyId: ws.company.id,
        name: 'Online ordering',
        goal: '',
        status: { state: 'active' },
        createdAt: at,
        updatedAt: at,
      },
    },
    designs: Object.fromEntries(
      documentIds.map((documentId, i) => [
        `de_${i + 1}`,
        { id: `de_${i + 1}`, engagementId: 'en_1', name: `Design ${i + 1}`, documentId, createdAt: at },
      ]),
    ),
  };
}

const folder = (companyId: string) => join(root, 'companies', companyId, 'designs');

describe('creating and saving a design', () => {
  it('creates a file, reads it back once listed, and saves over its revision, keeping the last good copy', async () => {
    const { id } = await client('Harbour Bakery', ['doc_checkout']);
    const created = await designs.create(id, 'doc_checkout', designFile('doc_checkout'));
    const read = await designs.read(id, 'doc_checkout');
    expect(read.revision).toBe(created.revision);
    const saved = await designs.save(id, 'doc_checkout', designFile('doc_checkout', 'Checkout, mobile'), created.revision);
    expect((await designs.read(id, 'doc_checkout')).revision).toBe(saved.revision);
    expect(JSON.parse(readFileSync(join(folder(id), 'doc_checkout.previous.stylecode.json'), 'utf8')).document.name).toBe(
      'Checkout',
    );
    expect(await designs.list(id)).toEqual([{ documentId: 'doc_checkout', problem: null, sizeBytes: expect.any(Number) }]);
  });

  it('refuses a stale revision, saying it changed in another tab', async () => {
    const { id } = await client('Harbour Bakery', ['doc_checkout']);
    const first = await designs.create(id, 'doc_checkout', designFile('doc_checkout'));
    await designs.save(id, 'doc_checkout', designFile('doc_checkout', 'Tab one'), first.revision);
    await expect(designs.save(id, 'doc_checkout', designFile('doc_checkout', 'Tab two'), first.revision)).rejects.toMatchObject({
      status: 409,
      message: 'This design changed in another tab. Reload it to carry on.',
    });
  });

  it('only creates: an id with a file is refused, listed or not', async () => {
    const { id } = await client('Harbour Bakery', ['doc_listed']);
    await designs.create(id, 'doc_listed', designFile('doc_listed'));
    await designs.create(id, 'doc_unlisted', designFile('doc_unlisted'));
    for (const doc of ['doc_listed', 'doc_unlisted']) {
      await expect(designs.create(id, doc, designFile(doc, 'Overwrite'))).rejects.toMatchObject({ status: 409 });
    }
    expect(JSON.parse(readFileSync(join(folder(id), 'doc_listed.stylecode.json'), 'utf8')).document.name).toBe('Checkout');
  });

  it('refuses a file parseProject rejects, a file for another document, one too large, and a bad id', async () => {
    const { id } = await client('Harbour Bakery', ['doc_checkout']);
    await expect(designs.create(id, 'doc_checkout', { format: 'stylecode', version: 99 })).rejects.toMatchObject({ status: 400 });
    await expect(designs.create(id, 'doc_checkout', designFile('doc_other'))).rejects.toMatchObject({ status: 400 });
    const huge = designFile('doc_checkout');
    (huge.document as { name: string }).name = 'x'.repeat(51 * 1024 * 1024);
    await expect(designs.create(id, 'doc_checkout', huge)).rejects.toMatchObject({ status: 413 });
    await expect(designs.create(id, '../x', designFile('../x'))).rejects.toMatchObject({ status: 400 });
    expect(existsSync(join(folder(id), 'doc_checkout.stylecode.json'))).toBe(false);
  });

  it('reads, saves and downloads only designs the client lists, so another client’s can’t be reached', async () => {
    const bakery = await client('Harbour Bakery', ['doc_bakery']);
    const karoo = await client('Karoo Freight', ['doc_karoo']);
    const created = await designs.create(karoo.id, 'doc_karoo', designFile('doc_karoo'));
    await designs.create(bakery.id, 'doc_unlisted', designFile('doc_unlisted'));
    for (const [company, doc] of [
      [bakery.id, 'doc_karoo'],
      [bakery.id, 'doc_unlisted'],
    ]) {
      await expect(designs.read(company, doc)).rejects.toMatchObject({ status: 404 });
      await expect(designs.raw(company, doc)).rejects.toMatchObject({ status: 404 });
      await expect(designs.save(company, doc, designFile(doc), created.revision)).rejects.toMatchObject({ status: 404 });
    }
  });

  it('lists a damaged design with the reason, offers its file as it is, and never saves a read-only client’s', async () => {
    const { id } = await client('Harbour Bakery', ['doc_damaged']);
    mkdirSync(folder(id));
    writeFileSync(join(folder(id), 'doc_damaged.stylecode.json'), '{ not json');
    expect((await designs.list(id))[0].problem).toMatch(/damaged/);
    await expect(designs.read(id, 'doc_damaged')).rejects.toMatchObject({ status: 422 });
    expect((await designs.raw(id, 'doc_damaged')).toString()).toBe('{ not json');

    const other = await client('Karoo Freight', ['doc_k']);
    const created = await designs.create(other.id, 'doc_k', designFile('doc_k'));
    const file = join(root, 'companies', other.id, 'workspace.json');
    const ws = JSON.parse(readFileSync(file, 'utf8')) as CompanyWorkspace;
    ws.designs.de_1.name = ''; // a problem: the client opens read-only
    writeFileSync(file, JSON.stringify(ws));
    await expect(designs.save(other.id, 'doc_k', designFile('doc_k', 'Changed'), created.revision)).rejects.toMatchObject({
      status: 409,
    });
    await expect(designs.addAsset(other.id, PNG, 'image/png')).rejects.toMatchObject({ status: 409 });
  });
});

describe('images', () => {
  it('stores an image in the company named, under the id its bytes hash to, and only once', async () => {
    const bakery = await client('Harbour Bakery');
    const karoo = await client('Karoo Freight');
    const { id: assetId } = await designs.addAsset(bakery.id, PNG, 'image/png');
    expect(assetId).toBe(assetIdOf(PNG));
    expect(await designs.addAsset(bakery.id, PNG, 'image/png')).toEqual({ id: assetId });
    expect(await designs.openAsset(bakery.id, assetId)).toEqual({ type: 'image/png', bytes: PNG });
    await expect(designs.openAsset(karoo.id, assetId)).rejects.toMatchObject({ status: 404 });
    await expect(designs.addAsset(bakery.id, PNG, 'text/html')).rejects.toMatchObject({ status: 415 });
    await expect(designs.openAsset(bakery.id, '../asset')).rejects.toMatchObject({ status: 400 });
  });
});

describe('clearing up after a permanent save', () => {
  async function withImages() {
    const c = await client('Harbour Bakery', ['doc_a', 'doc_b']);
    const shared = (await designs.addAsset(c.id, PNG, 'image/png')).id;
    const own = (await designs.addAsset(c.id, OTHER_PNG, 'image/png')).id;
    await designs.create(c.id, 'doc_a', designFile('doc_a', 'A', [shared, own]));
    await designs.create(c.id, 'doc_b', designFile('doc_b', 'B', [shared]));
    return { ...c, shared, own };
  }
  const assets = (id: string) => readdirSync(join(folder(id), 'assets')).filter((n) => !n.endsWith('.type'));

  it('deleting a design removes its file and the images only it used; a shared image stays until both are gone', async () => {
    const c = await withImages();
    const one = withDesigns(c.ws, ['doc_b']);
    const r1 = await store.save(c.id, one, c.revision, true);
    expect(readdirSync(folder(c.id)).filter((n) => n.endsWith('.json'))).toEqual(['doc_b.stylecode.json']);
    expect(assets(c.id)).toEqual([c.shared]);
    await store.save(c.id, withDesigns(c.ws, []), r1.revision, true);
    expect(readdirSync(folder(c.id)).filter((n) => n.endsWith('.json'))).toEqual([]);
    expect(assets(c.id)).toEqual([]);
  });

  it('deleting the engagement removes its designs and images, as a save without them', async () => {
    const c = await withImages();
    const ws = { ...c.ws, engagements: {}, designs: {} };
    await store.save(c.id, ws, c.revision, false);
    expect(readdirSync(folder(c.id)).filter((n) => n.endsWith('.json'))).toEqual([]);
    expect(assets(c.id)).toEqual([]);
  });

  it('removes designs and images nothing lists once they are a day old and weren’t written since the server started', async () => {
    const c = await client('Harbour Bakery', []);
    await designs.create(c.id, 'doc_orphan', designFile('doc_orphan'));
    const image = (await designs.addAsset(c.id, PNG, 'image/png')).id;
    // Written in this server's life: a permanent save keeps them, so undo and redo can't lose them.
    let r = await store.save(c.id, c.ws, c.revision, true);
    expect(existsSync(join(folder(c.id), 'doc_orphan.stylecode.json'))).toBe(true);
    // After a restart, and a day on, they go.
    const old = new Date(now.getTime() - 2 * DAY);
    for (const path of [join(folder(c.id), 'doc_orphan.stylecode.json'), join(folder(c.id), 'assets', image)])
      utimesSync(path, old, old);
    store = new WorkspaceStore(root, { now: () => now, retry: { attempts: 2, delayMs: 1 } });
    designs = new DesignFiles(store, { now: () => now });
    r = await store.save(c.id, c.ws, (await store.read(c.id)).revision, true);
    expect(r.revision).toMatch(/^[0-9a-f]{64}$/);
    expect(existsSync(join(folder(c.id), 'doc_orphan.stylecode.json'))).toBe(false);
    expect(assets(c.id)).toEqual([]);
  });

  it('deleting the client removes its designs with its folder', async () => {
    const c = await withImages();
    await store.remove(c.id, 'Harbour Bakery');
    expect(existsSync(join(root, 'companies', c.id))).toBe(false);
  });
});
