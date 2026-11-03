import { describe, expect, it } from 'vitest';
import { createNode } from './defaults';
import { createDocument } from './document';
import { layoutOps, layoutRoots, type TextMeasure } from './layout';
import { applyOps, type Op } from './ops';
import type { DesignDocument, DesignNode, NodeProps } from './types';

/** Deterministic stand-in for the browser: 8px per character, 20px per line. */
const measure: TextMeasure = (node, width) => {
  const natural = node.text.length * 8;
  if (width === undefined) return { width: natural, height: 20 };
  return { width, height: Math.max(1, Math.ceil(natural / Math.max(1, width))) * 20 };
};

function build(frame: Partial<NodeProps>, children: { type?: DesignNode['type']; props: Partial<NodeProps>; id: string }[]) {
  const base = createDocument();
  const ops: Op[] = [
    { type: 'create', parentId: base.rootId, index: 0, nodes: [createNode('frame', { x: 50, y: 60, ...frame }, 'f')] },
  ];
  children.forEach((c, i) =>
    ops.push({ type: 'create', parentId: 'f', index: i, nodes: [createNode(c.type ?? 'rect', c.props, c.id)] }),
  );
  return applyOps(base, ops).doc;
}

function laidOut(doc: DesignDocument): DesignDocument {
  return applyOps(doc, layoutOps(doc, layoutRoots(doc, Object.keys(doc.nodes)), measure)).doc;
}

const box = (doc: DesignDocument, id: string) => {
  const n = doc.nodes[id];
  return [n.x, n.y, n.width, n.height];
};

describe('auto-layout engine', () => {
  it('places a row with gap and padding', () => {
    const doc = laidOut(
      build({ layout: 'row', gap: 10, paddingLeft: 20, paddingTop: 5, width: 400, height: 100 }, [
        { id: 'a', props: { width: 50, height: 30 } },
        { id: 'b', props: { width: 70, height: 40 } },
      ]),
    );
    expect(box(doc, 'a')).toEqual([20, 5, 50, 30]);
    expect(box(doc, 'b')).toEqual([80, 5, 70, 40]);
    expect(box(doc, 'f')).toEqual([50, 60, 400, 100]);
  });

  it('hugs its content', () => {
    const doc = laidOut(
      build(
        {
          layout: 'column',
          gap: 8,
          paddingTop: 10,
          paddingBottom: 10,
          paddingLeft: 12,
          paddingRight: 12,
          widthMode: 'hug',
          heightMode: 'hug',
        },
        [
          { id: 'a', props: { width: 50, height: 30 } },
          { id: 'b', props: { width: 90, height: 40 } },
        ],
      ),
    );
    expect(box(doc, 'f')).toEqual([50, 60, 114, 98]);
  });

  it('shares free space between fill children and stretches across', () => {
    const doc = laidOut(
      build({ layout: 'row', gap: 10, width: 330, height: 100, align: 'center' }, [
        { id: 'a', props: { width: 100, height: 20 } },
        { id: 'b', props: { width: 5, height: 20, widthMode: 'fill' } },
        { id: 'c', props: { width: 5, height: 20, widthMode: 'fill', heightMode: 'fill' } },
      ]),
    );
    expect(box(doc, 'b')).toEqual([110, 40, 105, 20]);
    expect(box(doc, 'c')).toEqual([225, 0, 105, 100]);
  });

  it('never squeezes a filling frame below its own padding and border, as CSS does', () => {
    const base = build({ layout: 'row', width: 100, height: 50 }, [{ id: 'a', props: { width: 80, height: 20 } }]);
    const doc = laidOut(
      applyOps(base, [
        {
          type: 'create',
          parentId: 'f',
          index: 1,
          nodes: [
            createNode(
              'frame',
              { layout: 'row', widthMode: 'fill', paddingLeft: 10, paddingRight: 10, stroke: '#000000', strokeWidth: 2 },
              'g',
            ),
          ],
        },
        { type: 'create', parentId: 'f', index: 2, nodes: [createNode('rect', { widthMode: 'fill', height: 10 }, 'r')] },
      ]).doc,
    );
    // 100 - 80 = 20 free; the frame needs 24 for padding and border, so it gets 24 and the rect nothing.
    expect(doc.nodes.g.width).toBe(24);
    expect(doc.nodes.r.width).toBe(0);
  });

  it('treats fill as fixed where the parent hugs, since there is no space to fill', () => {
    const doc = laidOut(
      build({ layout: 'row', widthMode: 'hug', heightMode: 'hug' }, [
        { id: 'a', props: { width: 40, height: 20 } },
        { id: 'b', props: { width: 30, height: 10, widthMode: 'fill', heightMode: 'fill' } },
      ]),
    );
    expect(box(doc, 'b')).toEqual([40, 0, 30, 10]);
    expect(box(doc, 'f').slice(2)).toEqual([70, 20]);
  });

  it('distributes with justify and aligns across', () => {
    const make = (justify: NodeProps['justify'], align: NodeProps['align']) =>
      laidOut(
        build({ layout: 'row', justify, align, gap: 10, width: 300, height: 100 }, [
          { id: 'a', props: { width: 50, height: 20 } },
          { id: 'b', props: { width: 50, height: 40 } },
        ]),
      );
    expect(box(make('center', 'start'), 'a').slice(0, 2)).toEqual([95, 0]);
    expect(box(make('end', 'end'), 'a').slice(0, 2)).toEqual([190, 80]);
    expect(box(make('space-between', 'center'), 'b').slice(0, 2)).toEqual([250, 30]);
  });

  it('accounts for the frame border like CSS border-box', () => {
    const doc = laidOut(
      build({ layout: 'row', stroke: '#000000', strokeWidth: 3, widthMode: 'hug', heightMode: 'hug', paddingLeft: 4 }, [
        { id: 'a', props: { width: 50, height: 20 } },
      ]),
    );
    expect(box(doc, 'a').slice(0, 2)).toEqual([4, 0]);
    expect(box(doc, 'f').slice(2)).toEqual([60, 26]);
  });

  it('wraps fill-width text and grows a hugging parent', () => {
    const doc = laidOut(
      build({ layout: 'column', width: 100, heightMode: 'hug', paddingTop: 10, paddingBottom: 10 }, [
        { id: 't', type: 'text', props: { text: 'x'.repeat(30), widthMode: 'fill', textResize: 'auto-height' } },
      ]),
    );
    // 240px of text at 100px wide wraps to 3 lines.
    expect(box(doc, 't')).toEqual([0, 10, 100, 60]);
    expect(doc.nodes.f.height).toBe(80);
  });

  it('lays out nested auto-layout frames and skips hidden and absolute children', () => {
    const base = build({ layout: 'row', widthMode: 'hug', heightMode: 'hug', gap: 10 }, [
      { id: 'a', props: { width: 30, height: 30 } },
      { id: 'hidden', props: { width: 300, height: 300, visible: false } },
      { id: 'abs', props: { width: 300, height: 300, positioning: 'absolute', x: 7, y: 9 } },
    ]);
    const doc = laidOut(
      applyOps(base, [
        {
          type: 'create',
          parentId: 'f',
          index: 1,
          nodes: [createNode('frame', { layout: 'column', widthMode: 'hug', heightMode: 'hug', gap: 4 }, 'inner')],
        },
        { type: 'create', parentId: 'inner', index: 0, nodes: [createNode('rect', { width: 20, height: 10 }, 'i1')] },
        { type: 'create', parentId: 'inner', index: 1, nodes: [createNode('rect', { width: 25, height: 10 }, 'i2')] },
      ]).doc,
    );
    expect(box(doc, 'inner')).toEqual([40, 0, 25, 24]);
    expect(box(doc, 'i2')).toEqual([0, 14, 25, 10]);
    expect(box(doc, 'f').slice(2)).toEqual([65, 30]);
    expect(box(doc, 'abs')).toEqual([7, 9, 300, 300]);
  });

  it('finds the outermost auto-layout frame affected by a change', () => {
    const base = build({ layout: 'row' }, [{ id: 'a', props: {} }]);
    const doc = applyOps(base, [
      { type: 'create', parentId: 'f', index: 1, nodes: [createNode('frame', { layout: 'column' }, 'inner')] },
      { type: 'create', parentId: 'inner', index: 0, nodes: [createNode('rect', {}, 'deep')] },
      { type: 'create', parentId: base.rootId, index: 1, nodes: [createNode('frame', {}, 'plain')] },
      { type: 'create', parentId: 'plain', index: 0, nodes: [createNode('rect', {}, 'free')] },
    ]).doc;
    expect(layoutRoots(doc, ['deep'])).toEqual(['f']);
    expect(layoutRoots(doc, ['free'])).toEqual([]);
  });

  it('lays out an auto-layout frame that ignores its parent auto layout', () => {
    const base = build({ layout: 'column', gap: 8, width: 300, height: 200 }, [{ id: 'a', props: { width: 50, height: 30 } }]);
    const doc = laidOut(
      applyOps(base, [
        {
          type: 'create',
          parentId: 'f',
          index: 1,
          nodes: [
            createNode(
              'frame',
              {
                layout: 'row',
                widthMode: 'hug',
                heightMode: 'hug',
                paddingLeft: 10,
                paddingRight: 10,
                positioning: 'absolute',
                x: 100,
                y: 100,
              },
              'badge',
            ),
          ],
        },
        {
          type: 'create',
          parentId: 'badge',
          index: 0,
          nodes: [createNode('text', { text: 'New', textResize: 'auto-width' }, 't')],
        },
      ]).doc,
    );
    // Positioned where it was put, but hugging its text.
    expect(box(doc, 'badge')).toEqual([100, 100, 44, 20]);
    const longer = applyOps(doc, [{ type: 'update', id: 't', props: { text: 'Brand new' } }]).doc;
    expect(box(laidOut(longer), 'badge')).toEqual([100, 100, 92, 20]);
  });

  it('never makes a box smaller than its padding and border, as CSS does', () => {
    const doc = laidOut(
      build({ layout: 'column', width: 100, height: 300 }, [
        {
          id: 'row',
          type: 'frame',
          props: {
            layout: 'row',
            widthMode: 'fill',
            heightMode: 'fixed',
            height: 10,
            paddingLeft: 60,
            paddingRight: 60,
            paddingTop: 8,
            paddingBottom: 8,
          },
        },
        { id: 'dot', type: 'ellipse', props: { width: 2, height: 2, stroke: '#000000', strokeWidth: 4 } },
      ]),
    );
    expect(box(doc, 'row')).toEqual([0, 0, 120, 16]);
    expect(box(doc, 'dot')).toEqual([0, 16, 8, 8]);
  });
});
