import { describe, expect, it } from 'vitest';
import { fakeMeasure } from '../codegen/fixtures';
import { screenCss, screenHtml } from '../codegen/html';
import { buildScreen } from '../codegen/screen';
import { createNode } from './defaults';
import { createDocument } from './document';
import { layoutOps, layoutRoots } from './layout';
import { applyOps, OpBuilder, type Op } from './ops';
import { parseProject, toProjectFile } from './serialize';
import type { DesignDocument, DesignNode } from './types';

/**
 * Performance budgets on a 5,000-layer document: 10 pages of 20 sections
 * (rows and grids) of 4 cards, each card an image, two texts and a button.
 * The budgets are several times what a laptop needs, so they only fail on a
 * real regression (something quadratic, or work repeated per layer), not on
 * a slow test machine.
 */

const pad = (n: number) => ({ paddingTop: n, paddingRight: n, paddingBottom: n, paddingLeft: n });

function bigDocument(pages = 10, sections = 20, cards = 4): DesignDocument {
  const doc = createDocument('Big');
  const nodes: Record<string, DesignNode> = { ...doc.nodes };
  const add = (parentId: string, node: DesignNode) => {
    nodes[node.id] = { ...node, parentId, children: [] };
    nodes[parentId] = { ...nodes[parentId], children: [...nodes[parentId].children, node.id] };
    return node.id;
  };
  for (let p = 0; p < pages; p++) {
    const page = add(
      doc.rootId,
      createNode('frame', {
        name: `Page ${p}`,
        x: p * 1600,
        width: 1440,
        height: 900,
        layout: 'column',
        gap: 24,
        heightMode: 'hug',
        ...pad(40),
      }),
    );
    for (let s = 0; s < sections; s++) {
      const section = add(
        page,
        createNode('frame', {
          layout: s % 3 === 0 ? 'grid' : 'row',
          columns: 4,
          gap: 16,
          widthMode: 'fill',
          heightMode: 'hug',
          ...pad(16),
        }),
      );
      for (let c = 0; c < cards; c++) {
        const card = add(
          section,
          createNode('frame', { layout: 'column', gap: 8, widthMode: 'fill', heightMode: 'hug', ...pad(12) }),
        );
        add(card, createNode('rect', { height: 120, widthMode: 'fill' }));
        add(
          card,
          createNode('text', { text: `Card ${p}-${s}-${c}`, fontSize: 18, textResize: 'auto-height', widthMode: 'fill' }),
        );
        add(
          card,
          createNode('text', {
            text: 'A short description that wraps onto a second line.',
            textResize: 'auto-height',
            widthMode: 'fill',
          }),
        );
        const button = add(card, createNode('frame', { layout: 'row', widthMode: 'hug', heightMode: 'hug', ...pad(10) }));
        add(button, createNode('text', { text: 'Open' }));
      }
    }
  }
  return { ...doc, nodes };
}

function time<T>(fn: () => T): { ms: number; value: T } {
  const start = performance.now();
  const value = fn();
  return { ms: performance.now() - start, value };
}

const settle = (doc: DesignDocument) => applyOps(doc, layoutOps(doc, layoutRoots(doc, Object.keys(doc.nodes)), fakeMeasure)).doc;

describe('a 5,000-layer document', () => {
  const raw = bigDocument();
  const doc = settle(raw);
  const firstPage = doc.nodes[doc.rootId].children[0];
  const card = doc.nodes[doc.nodes[firstPage].children[1]].children[1];
  const title = doc.nodes[card].children[1];

  it('has the expected size', () => {
    expect(Object.keys(doc.nodes).length).toBe(5011);
  });

  it('lays out every layer in well under a second', () => {
    const { ms } = time(() => settle(raw));
    expect(ms).toBeLessThan(1500);
  });

  it('re-lays out only what an edit affects, quickly', () => {
    const edit = applyOps(doc, [
      { type: 'update', id: title, props: { text: 'A much longer title that now wraps onto two lines' } },
    ]);
    const roots = layoutRoots(edit.doc, edit.touched, doc);
    // Just this page: the section, card and its siblings, not the other nine pages.
    expect(roots).toEqual([firstPage]);
    const { ms } = time(() => {
      for (let i = 0; i < 20; i++) layoutOps(edit.doc, roots, fakeMeasure);
    });
    expect(ms / 20).toBeLessThan(60);
  });

  it('applies single edits without copying more than it must', () => {
    const { ms } = time(() => {
      let d = doc;
      for (let i = 0; i < 100; i++) d = applyOps(d, [{ type: 'update', id: card, props: { x: i } }]).doc;
      return d;
    });
    expect(ms / 100).toBeLessThan(25);
  });

  it('builds a drag frame (move, lift out of the row, re-lay out) fast enough to follow the pointer', () => {
    const { ms } = time(() => {
      for (let i = 0; i < 30; i++) {
        const b = new OpBuilder(doc);
        b.push({ type: 'update', id: card, props: { x: i, positioning: 'absolute' } } as Op);
        const roots = layoutRoots(b.doc, [card], doc);
        applyOps(b.doc, layoutOps(b.doc, roots, fakeMeasure));
      }
    });
    expect(ms / 30).toBeLessThan(80);
  });

  it('writes the code for a 500-layer page in well under a second', () => {
    const { ms, value } = time(() => {
      const screen = buildScreen(doc, firstPage);
      return {
        html: screenHtml(screen, { imageUrl: (a) => a, stylesheets: ['page.css'] }).content,
        css: screenCss(screen).content,
      };
    });
    expect(value.html.length).toBeGreaterThan(10_000);
    expect(ms).toBeLessThan(1500);
  });

  it('saves and reopens in well under a second each way', () => {
    const save = time(() => JSON.stringify(toProjectFile(doc)));
    const open = time(() => parseProject(JSON.parse(save.value)));
    expect(open.value.ok).toBe(true);
    expect(save.ms).toBeLessThan(1000);
    expect(open.ms).toBeLessThan(1500);
  });
});
