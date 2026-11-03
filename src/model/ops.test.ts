import { describe, expect, it } from 'vitest';
import { createNode } from './defaults';
import { checkIntegrity, createDocument, getDepth, isAncestorOf } from './document';
import { applyOps, tryApplyOps, type Op } from './ops';
import type { DesignDocument, NodeType } from './types';

function frame(id: string, props = {}) {
  return createNode('frame', props, id);
}

describe('applyOps', () => {
  it('creates, updates, moves and deletes layers', () => {
    let doc = createDocument();
    const root = doc.rootId;
    doc = applyOps(doc, [
      { type: 'create', parentId: root, index: 0, nodes: [frame('f1')] },
      { type: 'create', parentId: 'f1', index: 0, nodes: [createNode('rect', {}, 'r1')] },
    ]).doc;
    expect(doc.nodes.f1.children).toEqual(['r1']);
    expect(doc.nodes.r1.parentId).toBe('f1');

    doc = applyOps(doc, [{ type: 'update', id: 'r1', props: { fill: '#FF0000', radius: 8 } }]).doc;
    expect(doc.nodes.r1.fill).toBe('#ff0000');
    expect(doc.nodes.r1.radius).toBe(8);

    doc = applyOps(doc, [{ type: 'move', id: 'r1', parentId: root, index: 0 }]).doc;
    expect(doc.nodes[root].children).toEqual(['r1', 'f1']);
    expect(doc.nodes.f1.children).toEqual([]);

    doc = applyOps(doc, [{ type: 'delete', id: 'f1' }]).doc;
    expect(doc.nodes.f1).toBeUndefined();
    expect(checkIntegrity(doc)).toEqual([]);
  });

  it('never mutates the input document', () => {
    const doc = createDocument();
    const snapshot = JSON.stringify(doc);
    applyOps(doc, [{ type: 'create', parentId: doc.rootId, index: 0, nodes: [frame('a')] }]);
    expect(JSON.stringify(doc)).toBe(snapshot);
  });

  it('is atomic: an invalid operation leaves the document untouched', () => {
    const doc = createDocument();
    const result = tryApplyOps(doc, [
      { type: 'create', parentId: doc.rootId, index: 0, nodes: [frame('a')] },
      { type: 'update', id: 'missing', props: { x: 1 } },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.opIndex).toBe(1);
    expect(Object.keys(doc.nodes)).toHaveLength(1);
  });

  it('rejects invalid property values and properties that do not apply', () => {
    const base = createDocument();
    const d = applyOps(base, [{ type: 'create', parentId: base.rootId, index: 0, nodes: [createNode('rect', {}, 'r')] }]).doc;
    expect(tryApplyOps(d, [{ type: 'update', id: 'r', props: { fill: 'blue' } }]).ok).toBe(false);
    expect(tryApplyOps(d, [{ type: 'update', id: 'r', props: { fontSize: 12 } }]).ok).toBe(false);
    expect(tryApplyOps(d, [{ type: 'update', id: 'r', props: { width: Number.NaN } }]).ok).toBe(false);
    expect(tryApplyOps(d, [{ type: 'update', id: 'r', props: { bogus: 1 } as never }]).ok).toBe(false);
  });

  it('refuses ids that collide with built-in object properties', () => {
    const base = createDocument();
    for (const id of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(tryApplyOps(base, [{ type: 'update', id, props: { name: 'x' } }]).ok).toBe(false);
      expect(tryApplyOps(base, [{ type: 'delete', id }]).ok).toBe(false);
      expect(
        tryApplyOps(base, [{ type: 'create', parentId: base.rootId, index: 0, nodes: [createNode('rect', {}, id)] }]).ok,
      ).toBe(false);
    }
    expect(Object.getPrototypeOf(base.nodes)).toBe(Object.prototype);
    expect(checkIntegrity(base)).toEqual([]);
  });

  it('keeps children arrays when only properties change', () => {
    const base = createDocument();
    const d = applyOps(base, [
      { type: 'create', parentId: base.rootId, index: 0, nodes: [frame('f')] },
      { type: 'create', parentId: 'f', index: 0, nodes: [createNode('rect', {}, 'r')] },
    ]).doc;
    const out = applyOps(d, [
      { type: 'update', id: 'f', props: { x: 5 } },
      { type: 'update', id: 'r', props: { x: 5 } },
    ]).doc;
    expect(out.nodes.f).not.toBe(d.nodes.f);
    expect(out.nodes.f.children).toBe(d.nodes.f.children);
    expect(out.nodes[base.rootId].children).toBe(d.nodes[base.rootId].children);
  });

  it('clamps numbers into range and wraps rotation', () => {
    const base = createDocument();
    const d = applyOps(base, [{ type: 'create', parentId: base.rootId, index: 0, nodes: [createNode('rect', {}, 'r')] }]).doc;
    const out = applyOps(d, [{ type: 'update', id: 'r', props: { width: -5, opacity: 3, rotation: 270 } }]).doc;
    expect(out.nodes.r.width).toBe(0);
    expect(out.nodes.r.opacity).toBe(1);
    expect(out.nodes.r.rotation).toBe(-90);
  });

  it('refuses structural errors', () => {
    const base = createDocument();
    const d = applyOps(base, [
      { type: 'create', parentId: base.rootId, index: 0, nodes: [frame('a')] },
      { type: 'create', parentId: 'a', index: 0, nodes: [frame('b')] },
      { type: 'create', parentId: 'b', index: 0, nodes: [createNode('rect', {}, 'r')] },
    ]).doc;
    expect(tryApplyOps(d, [{ type: 'move', id: 'a', parentId: 'b', index: 0 }]).ok).toBe(false); // cycle
    expect(tryApplyOps(d, [{ type: 'move', id: 'a', parentId: 'r', index: 0 }]).ok).toBe(false); // into a rect
    expect(tryApplyOps(d, [{ type: 'delete', id: base.rootId }]).ok).toBe(false);
    expect(tryApplyOps(d, [{ type: 'create', parentId: 'a', index: 0, nodes: [frame('b')] }]).ok).toBe(false); // duplicate id
    expect(tryApplyOps(d, [{ type: 'create', parentId: 'a', index: 0, nodes: [{ ...frame('x'), children: ['y'] }] }]).ok).toBe(
      false,
    ); // dangling child
  });

  it('creates whole subtrees and deletes them with their descendants', () => {
    const base = createDocument();
    const parent = { ...frame('p'), children: ['c1', 'c2'] };
    const d = applyOps(base, [
      {
        type: 'create',
        parentId: base.rootId,
        index: 0,
        nodes: [parent, createNode('rect', {}, 'c1'), createNode('text', {}, 'c2')],
      },
    ]).doc;
    expect(d.nodes.c2.parentId).toBe('p');
    expect(checkIntegrity(d)).toEqual([]);
    const after = applyOps(d, [{ type: 'delete', id: 'p' }]).doc;
    expect(Object.keys(after.nodes)).toEqual([base.rootId]);
  });
});

// ---------------------------------------------------------------------------
// Property-based check: any sequence of valid operations followed by its
// inverse returns the exact original document.
// ---------------------------------------------------------------------------

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function randomOp(doc: DesignDocument, random: () => number, counter: { n: number }): Op | null {
  const ids = Object.keys(doc.nodes);
  const pick = <T>(arr: readonly T[]) => arr[Math.floor(random() * arr.length)];
  const containers = ids.filter((id) => ['page', 'frame'].includes(doc.nodes[id].type));
  const layers = ids.filter((id) => id !== doc.rootId);
  const kind = random();

  if (kind < 0.35 || layers.length === 0) {
    const parentId = pick(containers);
    const type = pick<NodeType>(['frame', 'rect', 'ellipse', 'text']);
    const node = createNode(type, { x: Math.round(random() * 500), y: Math.round(random() * 500) }, `n${counter.n++}`);
    return { type: 'create', parentId, index: Math.floor(random() * (doc.nodes[parentId].children.length + 1)), nodes: [node] };
  }
  if (kind < 0.65) {
    const id = pick(layers);
    return {
      type: 'update',
      id,
      props: { x: Math.round(random() * 1000), rotation: Math.round(random() * 360), fill: random() > 0.5 ? '#123456' : null },
    };
  }
  if (kind < 0.85) {
    const id = pick(layers);
    const targets = containers.filter((c) => c !== id && !isAncestorOf(doc, id, c));
    const parentId = pick(targets);
    const len = doc.nodes[parentId].children.filter((c) => c !== id).length;
    return { type: 'move', id, parentId, index: Math.floor(random() * (len + 1)) };
  }
  // Prefer deleting shallow layers occasionally, deep ones otherwise.
  const id = pick(layers.sort((a, b) => getDepth(doc, b) - getDepth(doc, a)));
  return { type: 'delete', id };
}

describe('operation inverses', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])('restore the original document exactly (seed %i)', (seed) => {
    const random = rng(seed);
    const counter = { n: 0 };
    let doc = createDocument('prop');
    const history: { before: DesignDocument; inverse: Op[] }[] = [];

    for (let step = 0; step < 120; step++) {
      const batch: Op[] = [];
      let working = doc;
      const size = 1 + Math.floor(random() * 4);
      for (let k = 0; k < size; k++) {
        const op = randomOp(working, random, counter);
        if (!op) continue;
        working = applyOps(working, [op]).doc;
        batch.push(op);
      }
      const result = applyOps(doc, batch);
      expect(checkIntegrity(result.doc)).toEqual([]);
      history.push({ before: doc, inverse: result.inverse });
      doc = result.doc;
    }

    // Undo everything in reverse order.
    for (let i = history.length - 1; i >= 0; i--) {
      doc = applyOps(doc, history[i].inverse).doc;
      expect(doc).toEqual(history[i].before);
    }
  });
});
