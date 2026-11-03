import { describe, expect, it } from 'vitest';
import {
  alignOps,
  copyToClipboardData,
  distributeOps,
  duplicateOps,
  groupOps,
  pasteOps,
  reorderOps,
  ungroupOps,
} from './commands';
import { createNode } from './defaults';
import { checkIntegrity, createDocument } from './document';
import { worldBounds } from './geometry';
import { applyOps } from './ops';
import type { DesignDocument } from './types';

function setup(): DesignDocument {
  const base = createDocument();
  return applyOps(base, [
    {
      type: 'create',
      parentId: base.rootId,
      index: 0,
      nodes: [createNode('frame', { x: 100, y: 100, width: 800, height: 600 }, 'f')],
    },
    { type: 'create', parentId: 'f', index: 0, nodes: [createNode('rect', { x: 10, y: 10, width: 50, height: 50 }, 'a')] },
    { type: 'create', parentId: 'f', index: 1, nodes: [createNode('rect', { x: 200, y: 40, width: 100, height: 20 }, 'b')] },
    {
      type: 'create',
      parentId: 'f',
      index: 2,
      nodes: [createNode('ellipse', { x: 400, y: 300, width: 60, height: 60, rotation: 30 }, 'c')],
    },
  ]).doc;
}

const boundsOf = (doc: DesignDocument, ids: string[]) => ids.map((id) => worldBounds(doc, id));

function expectBoundsClose(actual: ReturnType<typeof boundsOf>, expected: ReturnType<typeof boundsOf>) {
  actual.forEach((b, i) => {
    expect(b.x).toBeCloseTo(expected[i].x, 1);
    expect(b.y).toBeCloseTo(expected[i].y, 1);
    expect(b.width).toBeCloseTo(expected[i].width, 1);
    expect(b.height).toBeCloseTo(expected[i].height, 1);
  });
}

describe('group / ungroup', () => {
  it('groups layers without moving them on the page, and ungroups back', () => {
    const doc = setup();
    const before = boundsOf(doc, ['a', 'b', 'c']);
    const grouped = groupOps(doc, ['a', 'c'])!;
    const g = applyOps(doc, grouped.ops).doc;
    expect(checkIntegrity(g)).toEqual([]);
    expect(g.nodes[grouped.groupId].children).toEqual(['a', 'c']);
    expect(g.nodes[grouped.groupId].parentId).toBe('f');
    expectBoundsClose(boundsOf(g, ['a', 'b', 'c']), before);

    const un = ungroupOps(g, [grouped.groupId])!;
    const u = applyOps(g, un.ops).doc;
    expect(u.nodes[grouped.groupId]).toBeUndefined();
    expect(u.nodes.f.children).toEqual(['b', 'a', 'c']);
    expectBoundsClose(boundsOf(u, ['a', 'b', 'c']), before);
  });
});

describe('reorder', () => {
  it('brings forward and sends to back', () => {
    const doc = setup();
    expect(applyOps(doc, reorderOps(doc, ['a'], 'forward')).doc.nodes.f.children).toEqual(['b', 'a', 'c']);
    expect(applyOps(doc, reorderOps(doc, ['a', 'b'], 'forward')).doc.nodes.f.children).toEqual(['c', 'a', 'b']);
    expect(applyOps(doc, reorderOps(doc, ['c'], 'back')).doc.nodes.f.children).toEqual(['c', 'a', 'b']);
    expect(applyOps(doc, reorderOps(doc, ['a'], 'front')).doc.nodes.f.children).toEqual(['b', 'c', 'a']);
    expect(reorderOps(doc, ['c'], 'forward')).toEqual([]);
  });
});

describe('align and distribute', () => {
  it('aligns a selection to its shared bounds', () => {
    const doc = setup();
    const out = applyOps(doc, alignOps(doc, ['a', 'b'], 'left')).doc;
    expect(worldBounds(out, 'a').x).toBeCloseTo(worldBounds(out, 'b').x, 6);
  });

  it('aligns a single layer to its parent frame', () => {
    const doc = setup();
    const out = applyOps(doc, alignOps(doc, ['b'], 'hcenter')).doc;
    const b = worldBounds(out, 'b');
    expect(b.x + b.width / 2).toBeCloseTo(100 + 400, 6);
  });

  it('distributes with equal gaps', () => {
    const doc = setup();
    const out = applyOps(doc, distributeOps(doc, ['a', 'b', 'c'], 'horizontal')).doc;
    const [a, b, c] = boundsOf(out, ['a', 'b', 'c']);
    expect(b.x - (a.x + a.width)).toBeCloseTo(c.x - (b.x + b.width), 1);
  });
});

describe('duplicate and clipboard', () => {
  it('duplicates with new ids above the original', () => {
    const doc = setup();
    const { ops, newIds } = duplicateOps(doc, ['b'], { x: 10, y: 10 });
    const out = applyOps(doc, ops).doc;
    expect(out.nodes.f.children).toEqual(['a', 'b', newIds[0], 'c']);
    expect(out.nodes[newIds[0]].x).toBe(210);
  });

  it('pastes into the source container in place, and centred into another frame', () => {
    const doc0 = setup();
    const doc = applyOps(doc0, [
      {
        type: 'create',
        parentId: doc0.rootId,
        index: 1,
        nodes: [createNode('frame', { x: 2000, y: 0, width: 400, height: 400 }, 'g')],
      },
    ]).doc;
    const clip = copyToClipboardData(doc, ['a'])!;
    const json = JSON.parse(JSON.stringify(clip));

    const same = pasteOps(doc, json, null);
    const s = applyOps(doc, same.ops).doc;
    expect(worldBounds(s, same.newIds[0])).toEqual(worldBounds(doc, 'a'));

    const other = pasteOps(doc, json, 'g');
    const o = applyOps(doc, other.ops).doc;
    const b = worldBounds(o, other.newIds[0]);
    expect(o.nodes[other.newIds[0]].parentId).toBe('g');
    expect(b.x + b.width / 2).toBeCloseTo(2200, 6);
    expect(b.y + b.height / 2).toBeCloseTo(200, 6);
  });
});
