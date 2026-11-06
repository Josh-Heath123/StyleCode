import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '../editor/editor';
import { createDocument } from '../model/document';
import { createNode } from '../model/defaults';

/**
 * Autosave and recovery, with IndexedDB replaced by a fake whose writes can be
 * made to fail (as they do when the browser's storage is full).
 */

const store = new Map<string, unknown>();
let failWrites = false;
let writes = 0;

vi.mock('./idb', () => ({
  PROJECTS: 'projects',
  ASSETS: 'assets',
  idbGetAll: async () => [...store.values()],
  idbGet: async (_s: string, key: string) => store.get(key),
  idbPut: async (_s: string, value: { id: string }) => {
    writes++;
    if (failWrites) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    store.set(value.id, structuredClone(value));
  },
  idbDelete: async (_s: string, key: string) => void store.delete(key),
}));

const { ProjectSession, KeptOpenError } = await import('./session');

function addRect(editor: Editor, x: number) {
  const { doc } = editor.getState();
  const frame = doc.nodes[doc.rootId].children[0];
  editor.apply([{ type: 'create', parentId: frame, index: 0, nodes: [createNode('rect', { x })] }], { label: 'Add rectangle' });
}

describe('autosave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('window', Object.assign(new EventTarget(), { confirm: () => false }));
    vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
    store.clear();
    failWrites = false;
    writes = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function started() {
    const editor = new Editor(createDocument());
    const session = new ProjectSession(editor);
    await session.init();
    await vi.advanceTimersByTimeAsync(0);
    return { editor, session };
  }

  it('saves once a moment after an edit, however much else happens meanwhile', async () => {
    const { editor, session } = await started();
    const before = writes;
    addRect(editor, 10);
    // Hovering and notices change the editor's state, but they aren't edits.
    for (let i = 0; i < 20; i++) {
      editor.setHover(null);
      editor.notify(`notice ${i}`);
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(writes - before).toBe(1);
    expect(session.getState().status).toBe('saved');
  });

  it('when saving fails, says so once and retries with growing waits, not every half second', async () => {
    const { editor, session } = await started();
    failWrites = true;
    const notices: string[] = [];
    editor.subscribe(() => {
      const n = editor.getState().notice;
      if (n && !notices.includes(`${n.id}`)) notices.push(`${n.id}`);
    });
    const before = writes;
    addRect(editor, 10);
    await vi.advanceTimersByTimeAsync(10_000);
    // The first attempt after 0.5 s, then retries after 2 s and 5 s.
    expect(writes - before).toBe(3);
    expect(notices).toHaveLength(1);
    expect(session.getState().status).toBe('error');
    expect(session.hasUnsavedWork()).toBe(true);

    // Storage frees up: the next retry saves it.
    failWrites = false;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(session.getState().status).toBe('saved');
    expect(session.hasUnsavedWork()).toBe(false);
  });

  it('keeps a project whose changes could not be saved open unless the user agrees to lose them', async () => {
    const { editor, session } = await started();
    failWrites = true;
    addRect(editor, 10);
    await vi.advanceTimersByTimeAsync(1000);
    const id = editor.getState().doc.id;

    session.confirmDiscard = () => false;
    await expect(session.newProject()).rejects.toBeInstanceOf(KeptOpenError);
    expect(editor.getState().doc.id).toBe(id);

    failWrites = false;
    session.confirmDiscard = () => true;
    await session.newProject();
    expect(editor.getState().doc.id).not.toBe(id);
    expect(session.getState().status).toBe('saved');
  });

  it('asks even when the failing save is the one still waiting to happen', async () => {
    const { editor, session } = await started();
    failWrites = true;
    addRect(editor, 10);
    // Straight away, before the half-second autosave has run.
    let asked = false;
    session.confirmDiscard = () => ((asked = true), false);
    await expect(session.newProject()).rejects.toBeInstanceOf(KeptOpenError);
    expect(asked).toBe(true);
    expect(session.getState().status).toBe('error');
  });

  it('skips a damaged project on start-up and opens the next one', async () => {
    const good = (await started()).editor.getState().doc;
    store.set('doc_damaged', {
      id: 'doc_damaged',
      name: 'Damaged',
      updatedAt: Date.now() + 1000,
      file: { format: 'stylecode', version: 4, document: { nodes: 'not layers' } },
    });
    const editor = new Editor(createDocument());
    const session = new ProjectSession(editor);
    await session.init();
    expect(editor.getState().doc.id).toBe(good.id);
    expect(editor.getState().notice?.text).toContain('“Damaged” couldn’t be opened');
    const listed = await session.listProjects();
    expect(listed.find((p) => p.id === 'doc_damaged')?.problem).toBe('The design has no layers.');
  });

  it('stops autosaving while paused (the recovery screen), and starts again after', async () => {
    const { editor, session } = await started();
    session.pause();
    const before = writes;
    addRect(editor, 10);
    await vi.advanceTimersByTimeAsync(2000);
    expect(writes).toBe(before);
    expect(session.hasUnsavedWork()).toBe(false);
    session.resume();
    await vi.advanceTimersByTimeAsync(1000);
    expect(writes).toBe(before + 1);
  });
});
