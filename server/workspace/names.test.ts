import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Counts reads of clients' files, to show a create no longer reads every one (Phase 5, decision 24).
const reads = vi.hoisted(() => ({ workspaceFiles: 0 }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>();
  const readFile = ((path: Parameters<typeof fs.readFile>[0], ...rest: unknown[]) => {
    if (String(path).endsWith('workspace.json')) reads.workspaceFiles += 1;
    return (fs.readFile as (...args: unknown[]) => unknown)(path, ...rest);
  }) as typeof fs.readFile;
  return { ...fs, default: { ...fs, readFile }, readFile };
});

const { WorkspaceStore } = await import('./store.ts');

let root: string;
let store: InstanceType<typeof WorkspaceStore>;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'stylecode-names-'));
  mkdirSync(join(root, 'companies'));
  store = new WorkspaceStore(root, { now: () => new Date('2026-11-24T09:00:00.000Z'), retry: { attempts: 2, delayMs: 1 } });
  reads.workspaceFiles = 0;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('client names kept in memory (Phase 5, decision 24)', () => {
  it('reads every client’s file for the first create only', async () => {
    for (let i = 0; i < 5; i += 1) await store.create({ name: `Client ${i}` });
    const before = reads.workspaceFiles;
    await store.create({ name: 'One more' });
    await expect(store.create({ name: 'client 3' })).rejects.toMatchObject({ status: 409 });
    expect(reads.workspaceFiles - before).toBe(0);
  });

  it('knows the clients already in the folder when it starts', async () => {
    await store.create({ name: 'Harbour Bakery' });
    const restarted = new WorkspaceStore(root);
    await expect(restarted.create({ name: 'HARBOUR bakery' })).rejects.toMatchObject({ status: 409 });
  });

  it('frees the old name on a rename, and takes the new one', async () => {
    const opened = await store.create({ name: 'Harbour Bakery' });
    await store.create({ name: 'Karoo Freight' });
    const renamed = { ...opened.workspace, company: { ...opened.workspace.company, name: 'Harbour Bakes' } };
    await store.save(opened.workspace.company.id, renamed, opened.revision, false);
    await expect(store.create({ name: 'harbour bakes' })).rejects.toMatchObject({ status: 409 });
    await expect(store.create({ name: 'Harbour Bakery' })).resolves.toMatchObject({ access: 'editable' });
  });

  it('still refuses a rename to another client’s name', async () => {
    const opened = await store.create({ name: 'Harbour Bakery' });
    await store.create({ name: 'Karoo Freight' });
    const renamed = { ...opened.workspace, company: { ...opened.workspace.company, name: 'karoo freight' } };
    await expect(store.save(opened.workspace.company.id, renamed, opened.revision, false)).rejects.toMatchObject({ status: 409 });
  });

  it('frees a deleted client’s name', async () => {
    const opened = await store.create({ name: 'Harbour Bakery' });
    await store.remove(opened.workspace.company.id, 'Harbour Bakery');
    await expect(store.create({ name: 'Harbour Bakery' })).resolves.toMatchObject({ access: 'editable' });
  });

  it('learns a client folder put in by hand when the list is read', async () => {
    await store.create({ name: 'Harbour Bakery' });
    const other = new WorkspaceStore(root);
    const copied = await other.create({ name: 'Karoo Freight' }); // as if copied into the folder
    expect(copied.workspace.company.name).toBe('Karoo Freight');
    await store.list();
    await expect(store.create({ name: 'Karoo Freight' })).rejects.toMatchObject({ status: 409 });
  });

  it('runs creates one at a time, so two at once can’t take the same name', async () => {
    const results = await Promise.allSettled([store.create({ name: 'Same' }), store.create({ name: 'same' })]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
  });

  it('gives an unreadable client no name, as the list does', async () => {
    const opened = await store.create({ name: 'Harbour Bakery' });
    writeFileSync(join(root, 'companies', opened.workspace.company.id, 'workspace.json'), '{ not json');
    const restarted = new WorkspaceStore(root);
    await expect(restarted.create({ name: 'Harbour Bakery' })).resolves.toMatchObject({ access: 'editable' });
  });
});
