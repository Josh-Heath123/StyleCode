import { describe, expect, it } from 'vitest';
import { removeAutoLayoutOps, tidyFrameOps, wrapInAutoLayoutOps } from './autolayout';
import { createNode } from './defaults';
import { checkIntegrity, createDocument } from './document';
import { arrange } from './infer';
import { layoutOps, layoutRoots, type TextMeasure } from './layout';
import { applyOps, type Op } from './ops';
import type { DesignDocument, Rect } from './types';

const measure: TextMeasure = (node) => ({ width: node.text.length * 8, height: 20 });
const settle = (doc: DesignDocument) => applyOps(doc, layoutOps(doc, layoutRoots(doc, Object.keys(doc.nodes)), measure)).doc;

const r = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });

function frameWith(boxes: Record<string, Rect>, frame: Rect = r(0, 0, 1000, 600)) {
  const base = createDocument();
  const ops: Op[] = [{ type: 'create', parentId: base.rootId, index: 0, nodes: [createNode('frame', frame, 'f')] }];
  Object.entries(boxes).forEach(([id, b], i) =>
    ops.push({ type: 'create', parentId: 'f', index: i, nodes: [createNode('rect', b, id)] }),
  );
  return applyOps(base, ops).doc;
}

describe('arrange (XY-cut)', () => {
  it('finds a column of rows in a card grid', () => {
    const a = arrange([
      { id: 'a', box: r(0, 0, 100, 80) },
      { id: 'b', box: r(120, 0, 100, 80) },
      { id: 'c', box: r(0, 100, 100, 80) },
      { id: 'd', box: r(120, 100, 100, 80) },
    ]);
    expect(a.kind).toBe('stack');
    if (a.kind !== 'stack') return;
    expect(a.direction).toBe('column');
    expect(a.gap).toBe(20);
    expect(a.items.map((it) => (it.kind === 'stack' ? it.direction : it.kind))).toEqual(['row', 'row']);
  });

  it('splits a feature section into columns when the gaps between cards are widest', () => {
    const items = [0, 1, 2].flatMap((col) => [
      { id: `icon${col}`, box: r(col * 340, 0, 40, 40) },
      { id: `title${col}`, box: r(col * 340, 56, 200, 24) },
      { id: `body${col}`, box: r(col * 340, 92, 300, 60) },
    ]);
    const a = arrange(items);
    expect(a.kind === 'stack' && a.direction).toBe('row');
    if (a.kind !== 'stack') return;
    expect(a.items.map((it) => (it.kind === 'stack' ? it.direction : it.kind))).toEqual(['column', 'column', 'column']);
  });

  it('clusters a nav bar into logo, links and button', () => {
    const a = arrange([
      { id: 'logo', box: r(20, 20, 80, 20) },
      { id: 'l1', box: r(400, 22, 50, 16) },
      { id: 'l2', box: r(480, 22, 50, 16) },
      { id: 'l3', box: r(560, 22, 50, 16) },
      { id: 'cta', box: r(880, 12, 100, 36) },
    ]);
    expect(a.kind === 'stack' && a.spread).toBe(true);
    if (a.kind !== 'stack') return;
    expect(a.direction).toBe('row');
    expect(a.align).toBe('center');
    expect(a.items.map((it) => it.kind)).toEqual(['leaf', 'stack', 'leaf']);
    const links = a.items[1];
    expect(links.kind === 'stack' && links.typicalGap).toBe(30);
  });

  it('keeps overlapping layers together as a freeform group', () => {
    expect(
      arrange([
        { id: 'a', box: r(0, 0, 100, 100) },
        { id: 'b', box: r(50, 50, 100, 100) },
      ]).kind,
    ).toBe('freeform');
  });
});

describe('tidy into auto-layout', () => {
  it('converts a frame and keeps layers close to where they were drawn', () => {
    const doc = frameWith({ a: r(40, 40, 100, 50), b: r(40, 112, 120, 50), c: r(40, 178, 80, 50) });
    const result = tidyFrameOps(doc, 'f');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const out = settle(applyOps(doc, result.ops).doc);
    expect(checkIntegrity(out)).toEqual([]);
    expect(out.nodes.f).toMatchObject({ layout: 'column', gap: 19, paddingTop: 40, paddingLeft: 40, align: 'start' });
    expect([out.nodes.a.y, out.nodes.b.y, out.nodes.c.y]).toEqual([40, 109, 178]);
  });

  it('builds nested rows for a grid and space-between for clusters', () => {
    const doc = frameWith(
      {
        logo: r(20, 20, 80, 20),
        l1: r(400, 22, 50, 16),
        l2: r(480, 22, 50, 16),
        cta: r(880, 12, 100, 36),
      },
      r(0, 0, 1000, 60),
    );
    const result = tidyFrameOps(doc, 'f');
    if (!result.ok) throw new Error(result.error);
    const out = settle(applyOps(doc, result.ops).doc);
    expect(out.nodes.f).toMatchObject({ layout: 'row', justify: 'space-between', align: 'center' });
    const links = out.nodes[out.nodes.f.children[1]];
    expect(links).toMatchObject({ layout: 'row', gap: 30, widthMode: 'hug', name: 'Row' });
    expect(links.children).toEqual(['l1', 'l2']);
    // The button stays pinned to the right edge (padding preserved).
    expect(out.nodes.cta.x + out.nodes.cta.width).toBe(980);
  });

  it('centres a single layer that sits in the middle, and keeps it centred', () => {
    const doc = frameWith({ label: r(40, 12, 80, 20) }, r(0, 0, 160, 44));
    const result = tidyFrameOps(doc, 'f');
    if (!result.ok) throw new Error(result.error);
    const out = settle(applyOps(doc, result.ops).doc);
    expect(out.nodes.f).toMatchObject({ layout: 'row', justify: 'center', align: 'center', paddingLeft: 40, paddingTop: 12 });
    const wider = settle(applyOps(out, [{ type: 'update', id: 'label', props: { width: 120 } }]).doc);
    expect(wider.nodes.label.x).toBe(20);
  });

  it('keeps a single off-centre layer where it was', () => {
    const doc = frameWith({ a: r(10, 30, 80, 20) }, r(0, 0, 300, 100));
    const result = tidyFrameOps(doc, 'f');
    if (!result.ok) throw new Error(result.error);
    const out = settle(applyOps(doc, result.ops).doc);
    expect(out.nodes.f).toMatchObject({ justify: 'start', align: 'start' });
    expect([out.nodes.a.x, out.nodes.a.y]).toEqual([10, 30]);
  });

  it('refuses to tidy layers that all overlap', () => {
    const doc = frameWith({ a: r(0, 0, 100, 100), b: r(50, 50, 100, 100) });
    expect(tidyFrameOps(doc, 'f').ok).toBe(false);
  });

  it('leaves notes out of a wrapped selection', () => {
    const base = frameWith({ a: r(100, 100, 80, 40), b: r(200, 100, 80, 40) });
    const doc = applyOps(base, [
      { type: 'create', parentId: base.rootId, index: 1, nodes: [createNode('note', { x: 900, y: 0, text: 'Tidy this' }, 'n')] },
    ]).doc;
    const result = wrapInAutoLayoutOps(doc, ['a', 'b', 'n']);
    if (!result.ok) throw new Error(result.error);
    const out = applyOps(doc, result.ops).doc;
    expect(out.nodes.n.parentId).toBe(doc.rootId);
    expect(out.nodes[result.frameId].children).toEqual(['a', 'b']);
    expect(wrapInAutoLayoutOps(doc, ['n'])).toEqual({
      ok: false,
      error: 'Notes stay outside layouts. Select the layers to arrange.',
    });
  });

  it('wraps a selection in a hugging auto-layout frame without moving it', () => {
    const doc = frameWith({ a: r(100, 100, 80, 40), b: r(200, 100, 80, 40), other: r(500, 400, 10, 10) });
    const result = wrapInAutoLayoutOps(doc, ['a', 'b']);
    if (!result.ok) throw new Error(result.error);
    const out = settle(applyOps(doc, result.ops).doc);
    const wrapper = out.nodes[result.frameId];
    expect(wrapper).toMatchObject({
      layout: 'row',
      gap: 20,
      widthMode: 'hug',
      heightMode: 'hug',
      x: 100,
      y: 100,
      width: 180,
      height: 40,
    });
    expect(wrapper.parentId).toBe('f');
    expect(out.nodes.b.x).toBe(100);
  });

  it('removes auto-layout but keeps a layer filling its parent', () => {
    const doc = settle(frameWith({}, r(0, 0, 600, 200)));
    const withCard = settle(
      applyOps(doc, [
        { type: 'update', id: 'f', props: { layout: 'row' } },
        {
          type: 'create',
          parentId: 'f',
          index: 0,
          nodes: [createNode('frame', { layout: 'column', widthMode: 'fill', heightMode: 'hug' }, 'card')],
        },
      ]).doc,
    );
    const off = applyOps(withCard, removeAutoLayoutOps(withCard, ['card'])).doc;
    expect(off.nodes.card).toMatchObject({ layout: 'none', widthMode: 'fill', heightMode: 'fixed' });
  });

  it('removes auto-layout and leaves children where they are', () => {
    const doc = settle(frameWith({ a: r(40, 40, 100, 50), b: r(40, 112, 120, 50) }));
    const tidy = tidyFrameOps(doc, 'f');
    if (!tidy.ok) throw new Error(tidy.error);
    const laid = settle(applyOps(doc, tidy.ops).doc);
    const off = applyOps(laid, removeAutoLayoutOps(laid, ['f'])).doc;
    expect(off.nodes.f.layout).toBe('none');
    expect(off.nodes.b.y).toBe(laid.nodes.b.y);
  });

  it('measures text when tidying', () => {
    const base = createDocument();
    const doc = applyOps(base, [
      { type: 'create', parentId: base.rootId, index: 0, nodes: [createNode('frame', r(0, 0, 400, 200), 'f')] },
      {
        type: 'create',
        parentId: 'f',
        index: 0,
        nodes: [createNode('text', { ...r(20, 20, 80, 20), text: 'Hello there' }, 't1')],
      },
      { type: 'create', parentId: 'f', index: 1, nodes: [createNode('text', { ...r(20, 60, 40, 20), text: 'Hi' }, 't2')] },
    ]).doc;
    const result = tidyFrameOps(doc, 'f');
    if (!result.ok) throw new Error(result.error);
    const out = settle(applyOps(doc, result.ops).doc);
    expect(out.nodes.t1.width).toBe(88);
    expect(out.nodes.t2.y).toBe(60);
  });
});
