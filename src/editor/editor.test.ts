import { describe, expect, it } from 'vitest';
import { createNode } from '../model/defaults';
import { createDocument } from '../model/document';
import type { Op } from '../model/ops';
import { Editor } from './editor';

function setup() {
  const doc = createDocument();
  const editor = new Editor(doc);
  editor.apply([{ type: 'create', parentId: doc.rootId, index: 0, nodes: [createNode('rect', { x: 10, y: 10 }, 'r')] }], {
    label: 'Add rectangle',
    selection: ['r'],
  });
  return editor;
}

const x = (editor: Editor) => editor.getState().doc.nodes.r.x;

describe('Editor', () => {
  it('records changes and undoes / redoes them, restoring selection', () => {
    const editor = setup();
    editor.select([]);
    editor.apply([{ type: 'update', id: 'r', props: { x: 50 } }], { label: 'Move', selection: ['r'] });
    expect(x(editor)).toBe(50);
    editor.undo();
    expect(x(editor)).toBe(10);
    expect(editor.getState().selection).toEqual([]);
    editor.redo();
    expect(x(editor)).toBe(50);
    expect(editor.getState().selection).toEqual(['r']);
    editor.undo();
    editor.undo();
    expect(editor.getState().doc.nodes.r).toBeUndefined();
  });

  it('turns a gesture into a single undo step', () => {
    const editor = setup();
    editor.beginGesture();
    for (let i = 1; i <= 30; i++) editor.previewGesture([{ type: 'update', id: 'r', props: { x: 10 + i } }]);
    editor.commitGesture('Move');
    expect(x(editor)).toBe(40);
    editor.undo();
    expect(x(editor)).toBe(10);
    expect(editor.history.peekUndo()?.label).toBe('Add rectangle');
  });

  it('cancelling a gesture restores the document', () => {
    const editor = setup();
    const before = editor.getState().doc;
    editor.beginGesture();
    editor.previewGesture([{ type: 'update', id: 'r', props: { x: 99 } }]);
    editor.cancelGesture();
    expect(editor.getState().doc).toBe(before);
  });

  it('merges rapid nudges into one step', () => {
    const editor = setup();
    for (let i = 0; i < 5; i++) {
      editor.apply([{ type: 'update', id: 'r', props: { x: x(editor) + 1 } }], { label: 'Nudge', coalesceKey: 'nudge' });
    }
    expect(x(editor)).toBe(15);
    editor.undo();
    expect(x(editor)).toBe(10);
  });

  it('only merges nudges of the same layers', () => {
    const editor = setup();
    editor.apply([{ type: 'create', parentId: editor.getState().doc.rootId, index: 1, nodes: [createNode('rect', {}, 's')] }], {
      label: 'Add',
    });
    editor.apply([{ type: 'update', id: 'r', props: { x: 11 } }], { label: 'Nudge', coalesceKey: 'nudge:r' });
    editor.apply([{ type: 'update', id: 's', props: { x: 1 } }], { label: 'Nudge', coalesceKey: 'nudge:s' });
    editor.undo();
    expect(x(editor)).toBe(11);
    expect(editor.getState().doc.nodes.s.x).toBe(0);
  });

  it('rejects invalid batches without changing anything and explains why', () => {
    const editor = setup();
    const before = editor.getState().doc;
    const bad: Op[] = [
      { type: 'update', id: 'r', props: { x: 1 } },
      { type: 'update', id: 'r', props: { fill: 'not a colour' } },
    ];
    expect(editor.apply(bad, { label: 'Bad' })).toBeNull();
    expect(editor.getState().doc).toBe(before);
    expect(editor.getState().notice?.tone).toBe('error');
  });

  it('runs the normaliser inside the same transaction', () => {
    const editor = setup();
    editor.normalizer = (doc, touched) =>
      [...touched].filter((id) => doc.nodes[id].x > 100).map((id) => ({ type: 'update', id, props: { y: 0 } }) as Op);
    editor.apply([{ type: 'update', id: 'r', props: { x: 200 } }], { label: 'Move' });
    expect(editor.getState().doc.nodes.r.y).toBe(0);
    editor.undo();
    expect(editor.getState().doc.nodes.r).toMatchObject({ x: 10, y: 10 });
  });

  it('can discard the most recent transaction entirely', () => {
    const editor = setup();
    const tx = editor.apply([{ type: 'update', id: 'r', props: { x: 70 } }], { label: 'Move' })!;
    expect(editor.discardTransaction(tx.id)).toBe(true);
    expect(x(editor)).toBe(10);
    editor.redo();
    expect(x(editor)).toBe(10);
  });

  it('keeps the selection array stable while it does not change', () => {
    const editor = setup();
    const selection = editor.getState().selection;
    editor.beginGesture();
    editor.previewGesture([{ type: 'update', id: 'r', props: { x: 20 } }], ['r']);
    editor.previewGesture([{ type: 'update', id: 'r', props: { x: 30 } }], ['r']);
    expect(editor.getState().selection).toBe(selection);
    editor.commitGesture('Move');
  });

  it('shows an AI proposal without recording it; accepting makes one undo step from the AI', () => {
    const editor = setup();
    const view = { changed: ['r'], created: [], removed: [] };
    expect(editor.propose([{ type: 'update', id: 'r', props: { x: 99 } }], 'AI: move it', view)).toBe(true);
    expect(x(editor)).toBe(99);
    expect(editor.getState().proposal).toEqual(view);
    expect(editor.committedDoc.nodes.r.x).toBe(10);
    expect(editor.history.peekUndo()?.label).toBe('Add rectangle');

    const tx = editor.acceptProposal();
    expect(tx).toMatchObject({ label: 'AI: move it', source: 'ai' });
    expect(editor.getState().proposal).toBeNull();
    expect(editor.committedDoc.nodes.r.x).toBe(99);
    editor.undo();
    expect(x(editor)).toBe(10);
    editor.redo();
    expect(x(editor)).toBe(99);
  });

  it('puts the design back when a proposal is rejected, and keeps the design read-only during review', () => {
    const editor = setup();
    const deleted = [{ type: 'delete', id: 'r' }] as Op[];
    editor.propose(deleted, 'AI: remove', { changed: [], created: [], removed: [] });
    expect(editor.getState().doc.nodes.r).toBeUndefined();
    expect(editor.getState().selection).toEqual([]);
    editor.discardProposal();
    expect(x(editor)).toBe(10);
    // The selection the proposal removed comes back.
    expect(editor.getState().selection).toEqual(['r']);

    // Edits during review would be made on top of unrecorded changes, so they wait.
    editor.propose([{ type: 'update', id: 'r', props: { x: 99 } }], 'AI: move', { changed: ['r'], created: [], removed: [] });
    expect(editor.apply([{ type: 'update', id: 'r', props: { y: 40 } }], { label: 'Move' })).toBeNull();
    editor.beginGesture();
    expect(editor.inGesture).toBe(false);
    editor.setEditingText('r');
    expect(editor.getState().editingTextId).toBeNull();
    editor.redo();
    expect(editor.getState().notice?.text).toMatch(/Accept or reject the AI’s changes first/);
    expect(editor.hasProposal).toBe(true);
    expect(editor.getState().doc.nodes.r).toMatchObject({ x: 99, y: 10 });

    // Undo rejects the proposal, and only that.
    editor.undo();
    expect(editor.hasProposal).toBe(false);
    expect(editor.getState().doc.nodes.r).toMatchObject({ x: 10, y: 10 });
    expect(editor.history.peekUndo()?.label).toBe('Add rectangle');
    expect(editor.acceptProposal()).toBeNull();
  });

  it('holds background work until a drag ends and a proposal is accepted or rejected', async () => {
    const editor = setup();
    editor.beginGesture();
    let idle = false;
    void editor.whenIdle().then(() => (idle = true));
    await Promise.resolve();
    expect(idle).toBe(false);
    editor.commitGesture('Nothing');
    await Promise.resolve();
    expect(idle).toBe(true);

    editor.propose([{ type: 'update', id: 'r', props: { x: 99 } }], 'AI: move', { changed: ['r'], created: [], removed: [] });
    idle = false;
    void editor.whenIdle().then(() => (idle = true));
    await Promise.resolve();
    expect(idle).toBe(false);
    editor.acceptProposal();
    await Promise.resolve();
    expect(idle).toBe(true);
  });

  it('refuses a proposal that does not apply, without changing anything', () => {
    const editor = setup();
    const ok = editor.propose([{ type: 'update', id: 'missing', props: { x: 1 } }], 'AI: bad', {
      changed: [],
      created: [],
      removed: [],
    });
    expect(ok).toBe(false);
    expect(editor.hasProposal).toBe(false);
    expect(editor.getState().notice?.tone).toBe('error');
    expect(x(editor)).toBe(10);
  });
});
