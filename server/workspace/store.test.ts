import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CompanyWorkspace, FileRef } from '../../src/workspace/model/index.ts';
import { isSafeId, revisionOf, WorkspaceStore } from './store.ts';

let root: string;
let store: WorkspaceStore;
const NOW = new Date('2026-11-04T09:00:00.000Z');

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'stylecode-store-'));
  mkdirSync(join(root, 'companies')); // prepareDataFolder creates it in the real server.
  store = new WorkspaceStore(root, { now: () => NOW, retry: { attempts: 2, delayMs: 1 } });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const bakery = () => store.create({ name: 'Harbour Bakery', industry: 'Food' });

const companyFile = (id: string, name = 'workspace.json') => join(root, 'companies', id, name);
const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as CompanyWorkspace;

const withNotes = (ws: CompanyWorkspace, text: string): CompanyWorkspace => ({
  ...ws,
  company: { ...ws.company, notes: text },
});

describe('ids that become paths', () => {
  it('accepts ids StyleCode makes and refuses anything that could escape or collide', () => {
    expect(isSafeId('co_abc123')).toBe(true);
    for (const id of ['..', '../x', 'a/b', 'a\\b', 'CO_ABC', 'con', 'NUL', 'com1', '', 'x'.repeat(65), '__proto__', 'a.b']) {
      expect(isSafeId(id), id).toBe(false);
    }
  });
});

describe('companies', () => {
  it('creates a company as one folder, and lists it', async () => {
    const opened = await bakery();
    const id = opened.workspace.company.id;
    expect(opened.access).toBe('editable');
    expect(readdirSync(join(root, 'companies'))).toEqual([id]);
    expect(readdirSync(join(root, 'companies', id)).sort()).toEqual(['files', 'workspace.json']);
    expect(opened.revision).toBe(revisionOf(readFileSync(companyFile(id))));
    const [summary] = await store.list();
    expect(summary).toMatchObject({ id, name: 'Harbour Bakery', industry: 'Food', access: 'editable' });
  });

  it('refuses a name another company has, ignoring case and spaces', async () => {
    await bakery();
    await expect(store.create({ name: '  harbour BAKERY ' })).rejects.toMatchObject({ status: 409 });
    await expect(store.create({ name: '   ' })).rejects.toMatchObject({ status: 400 });
    await expect(store.create({ name: 'Ok', industry: 3 })).rejects.toMatchObject({ status: 400 });
  });

  it('lists a damaged company as unreadable rather than hiding it', async () => {
    const { workspace } = await bakery();
    writeFileSync(companyFile(workspace.company.id), '{ not json');
    expect((await store.list())[0]).toMatchObject({ id: workspace.company.id, name: null, access: 'unreadable' });
    await expect(store.read(workspace.company.id)).rejects.toMatchObject({ status: 422 });
  });
});

describe('saving', () => {
  it('saves over the revision it was based on, keeping the copy before', async () => {
    const opened = await bakery();
    const id = opened.workspace.company.id;
    const first = await store.save(id, withNotes(opened.workspace, 'one'), opened.revision, false);
    const second = await store.save(id, withNotes(opened.workspace, 'two'), first.revision, false);
    expect(readJson(companyFile(id)).company.notes).toBe('two');
    expect(readJson(companyFile(id, 'workspace.previous.json')).company.notes).toBe('one');
    expect(second.revision).toBe(revisionOf(readFileSync(companyFile(id))));
  });

  it('refuses a stale revision, as when the client was changed in another window', async () => {
    const opened = await bakery();
    const id = opened.workspace.company.id;
    await store.save(id, withNotes(opened.workspace, 'window one'), opened.revision, false);
    await expect(store.save(id, withNotes(opened.workspace, 'window two'), opened.revision, false)).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/changed in another window/),
    });
    expect(readJson(companyFile(id)).company.notes).toBe('window one');
  });

  it('refuses a missing or malformed revision', async () => {
    const opened = await bakery();
    for (const revision of [undefined, '', 'abc', 42]) {
      await expect(store.save(opened.workspace.company.id, opened.workspace, revision, false)).rejects.toMatchObject({
        status: 400,
      });
    }
  });

  it('refuses a workspace with problems, listing them, and leaves the file alone', async () => {
    const opened = await bakery();
    const id = opened.workspace.company.id;
    const before = readFileSync(companyFile(id), 'utf8');
    const broken = { ...opened.workspace, company: { ...opened.workspace.company, name: '' } };
    await expect(store.save(id, broken, opened.revision, false)).rejects.toMatchObject({
      status: 422,
      problems: [expect.objectContaining({ code: 'company.name' })],
    });
    expect(readFileSync(companyFile(id), 'utf8')).toBe(before);
  });

  it("refuses a workspace that belongs to another company, or isn't one", async () => {
    const opened = await bakery();
    const id = opened.workspace.company.id;
    const other = { ...opened.workspace, company: { ...opened.workspace.company, id: 'co_other' } };
    await expect(store.save(id, other, opened.revision, false)).rejects.toMatchObject({ status: 400 });
    await expect(store.save(id, { hello: 1 }, opened.revision, false)).rejects.toMatchObject({ status: 400 });
  });

  it('never saves over a file that has problems: it opens read-only and stays as it is', async () => {
    const opened = await bakery();
    const id = opened.workspace.company.id;
    const damaged = { ...opened.workspace, findings: { fd_x: { id: 'fd_x' } } };
    writeFileSync(companyFile(id), JSON.stringify(damaged));
    const reopened = await store.read(id);
    expect(reopened.access).toBe('read-only');
    expect(reopened.problems.length).toBeGreaterThan(0);
    await expect(store.save(id, opened.workspace, reopened.revision, false)).rejects.toMatchObject({ status: 409 });
    expect(JSON.parse(readFileSync(companyFile(id), 'utf8'))).toEqual(damaged);
  });

  it('survives an interrupted write: the last good file is untouched and no temporary file is left', async () => {
    const opened = await bakery();
    const id = opened.workspace.company.id;
    const before = readFileSync(companyFile(id), 'utf8');
    const failing = new WorkspaceStore(root, {
      retry: {
        attempts: 2,
        delayMs: 1,
        renameFile: async (from, to) => {
          if (to.endsWith('workspace.json')) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
          const { rename } = await import('node:fs/promises');
          await rename(from, to);
        },
      },
    });
    await expect(failing.save(id, withNotes(opened.workspace, 'lost'), opened.revision, false)).rejects.toMatchObject({
      code: 'EBUSY',
    });
    expect(readFileSync(companyFile(id), 'utf8')).toBe(before);
    expect(readdirSync(join(root, 'companies', id)).filter((n) => n.endsWith('.tmp'))).toEqual([]);
    // The previous copy holds the same good state, and the next save works.
    expect(readFileSync(companyFile(id, 'workspace.previous.json'), 'utf8')).toBe(before);
    await store.save(id, withNotes(opened.workspace, 'kept'), opened.revision, false);
    expect(readJson(companyFile(id)).company.notes).toBe('kept');
  });

  it('retries a rename Windows reports busy, then succeeds', async () => {
    const opened = await bakery();
    let fails = 2;
    const flaky = new WorkspaceStore(root, {
      retry: {
        attempts: 4,
        delayMs: 1,
        renameFile: async (from, to) => {
          if (to.endsWith('workspace.json') && fails-- > 0) throw Object.assign(new Error('busy'), { code: 'EPERM' });
          const { rename } = await import('node:fs/promises');
          await rename(from, to);
        },
      },
    });
    await flaky.save(opened.workspace.company.id, withNotes(opened.workspace, 'ok'), opened.revision, false);
    expect(readJson(companyFile(opened.workspace.company.id)).company.notes).toBe('ok');
  });

  it('saves one at a time: of two saves on the same revision, the second is refused', async () => {
    const opened = await bakery();
    const id = opened.workspace.company.id;
    const results = await Promise.allSettled([
      store.save(id, withNotes(opened.workspace, 'a'), opened.revision, false),
      store.save(id, withNotes(opened.workspace, 'b'), opened.revision, false),
    ]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
    expect(readJson(companyFile(id)).company.notes).toBe('a');
  });

  it('leaves no copy of deleted data behind after a permanent deletion', async () => {
    const opened = await bakery();
    const id = opened.workspace.company.id;
    const secret = await store.save(id, withNotes(opened.workspace, 'to be deleted'), opened.revision, false);
    const after = await store.save(id, withNotes(opened.workspace, ''), secret.revision, false);
    // An ordinary save keeps the copy before it.
    expect(readJson(companyFile(id, 'workspace.previous.json')).company.notes).toBe('to be deleted');
    await store.save(id, withNotes(opened.workspace, 'again'), after.revision, false);
    const latest = await store.read(id);
    await store.save(id, withNotes(opened.workspace, 'clean'), latest.revision, true);
    expect(readJson(companyFile(id)).company.notes).toBe('clean');
    expect(readJson(companyFile(id, 'workspace.previous.json')).company.notes).toBe('clean');
  });
});

describe('deleting a company', () => {
  it('needs the exact name, then removes the whole folder', async () => {
    const opened = await bakery();
    const id = opened.workspace.company.id;
    await store.addFile(id, [Buffer.from('menu')], 100);
    await expect(store.remove(id, 'harbour bakery')).rejects.toMatchObject({ status: 400 });
    await expect(store.remove(id, undefined)).rejects.toMatchObject({ status: 400 });
    expect(existsSync(join(root, 'companies', id))).toBe(true);
    await store.remove(id, 'Harbour Bakery');
    expect(readdirSync(join(root, 'companies'))).toEqual([]);
    expect(await store.list()).toEqual([]);
    await expect(store.read(id)).rejects.toMatchObject({ status: 404 });
  });

  it('finishes a deletion that a busy file interrupted', async () => {
    const leftover = join(root, 'companies', '.deleting-co_x-1234');
    mkdirSync(join(leftover, 'files'), { recursive: true });
    writeFileSync(join(leftover, 'workspace.json'), '{}');
    expect(await store.list()).toEqual([]);
    expect(existsSync(leftover)).toBe(false);
  });
});

describe('files', () => {
  const ref = (id: string, sizeBytes: number): FileRef => ({
    id,
    owner: { kind: 'company' },
    purpose: 'document',
    name: '../../Menu "final".pdf',
    mediaType: 'application/pdf',
    sizeBytes,
    addedBy: 'Sam',
    addedAt: NOW.toISOString(),
  });

  it('stores bytes by id, never by the name the browser gave', async () => {
    const opened = await bakery();
    const id = opened.workspace.company.id;
    const file = await store.addFile(id, [Buffer.from('hello '), Buffer.from('world')], 100);
    expect(file.sizeBytes).toBe(11);
    expect(isSafeId(file.id)).toBe(true);
    expect(readdirSync(join(root, 'companies', id, 'files'))).toEqual([file.id]);
    const ws = { ...opened.workspace, files: { [file.id]: ref(file.id, file.sizeBytes) } };
    await store.save(id, ws, opened.revision, false);
    const found = await store.openFile(id, file.id);
    expect(found.ref.name).toBe('../../Menu "final".pdf');
    expect(found.size).toBe(11);
  });

  it('refuses a file over the limit and keeps nothing of it', async () => {
    const opened = await bakery();
    const id = opened.workspace.company.id;
    await expect(store.addFile(id, [Buffer.alloc(60), Buffer.alloc(60)], 100)).rejects.toMatchObject({ status: 413 });
    expect(readdirSync(join(root, 'companies', id, 'files'))).toEqual([]);
  });

  it("won't open a file the client doesn't list", async () => {
    const opened = await bakery();
    const id = opened.workspace.company.id;
    const file = await store.addFile(id, [Buffer.from('x')], 100);
    await expect(store.openFile(id, file.id)).rejects.toMatchObject({ status: 404 });
    await expect(store.openFile(id, '..')).rejects.toMatchObject({ status: 404 });
  });

  it('removes bytes only once the client no longer lists the file', async () => {
    const opened = await bakery();
    const id = opened.workspace.company.id;
    const file = await store.addFile(id, [Buffer.from('x')], 100);
    const saved = await store.save(id, { ...opened.workspace, files: { [file.id]: ref(file.id, 1) } }, opened.revision, false);
    await expect(store.removeFile(id, file.id)).rejects.toMatchObject({ status: 409 });
    await store.save(id, opened.workspace, saved.revision, true);
    await store.removeFile(id, file.id);
    expect(readdirSync(join(root, 'companies', id, 'files'))).toEqual([]);
  });

  it('clears files no saved workspace lists, but never one uploaded since the server started', async () => {
    const opened = await bakery();
    const id = opened.workspace.company.id;
    const kept = await store.addFile(id, [Buffer.from('new')], 100);
    writeFileSync(join(root, 'companies', id, 'files', 'fi_orphan'), 'old');
    writeFileSync(join(root, 'companies', id, 'files', 'fi_half.tmp'), 'half');
    await store.save(id, withNotes(opened.workspace, 'x'), opened.revision, false);
    expect(readdirSync(join(root, 'companies', id, 'files'))).toEqual([kept.id]);
  });
});

describe('settings', () => {
  it("keeps the consultant's name in settings.json next to companies", async () => {
    expect(await store.readSettings()).toEqual({ consultantName: null });
    await expect(store.saveSettings({ consultantName: '  ' })).rejects.toMatchObject({ status: 400 });
    expect(await store.saveSettings({ consultantName: ' Sam Consultant ' })).toEqual({ consultantName: 'Sam Consultant' });
    expect(JSON.parse(readFileSync(join(root, 'settings.json'), 'utf8'))).toMatchObject({
      format: 'stylecode-settings',
      consultantName: 'Sam Consultant',
    });
    expect(await new WorkspaceStore(root).readSettings()).toEqual({ consultantName: 'Sam Consultant' });
  });
});
