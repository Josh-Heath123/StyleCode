import { expect, test } from '@playwright/test';

/**
 * The layout engine resolves auto-layout in the model; exported code
 * expresses the same layout with CSS flexbox and grid. This test generates
 * random auto-layout frames (rows, columns, wrapping rows and grids, with
 * size limits and column spans), lays them out with the engine, renders the
 * same frames with real CSS in the browser, and checks every box matches.
 */
test('the layout engine matches the browser’s flexbox and grid', async ({ page }) => {
  await page.goto('/#/editor');
  await page.waitForSelector('.canvas');

  const mismatches = await page.evaluate(async () => {
    // Modules come straight from the dev server, so the browser runs the real engine.
    const load = (path: string): Promise<any> => import(/* @vite-ignore */ path);
    const { createDocument } = await load('/src/model/document.ts');
    const { createNode } = await load('/src/model/defaults.ts');
    const { applyOps } = await load('/src/model/ops.ts');
    const { normalizeDocument } = await load('/src/canvas/normalize.ts');
    const css = await load('/src/render/css.ts');
    type Node = import('../src/model/types').DesignNode;
    type Doc = import('../src/model/types').DesignDocument;

    let seed = 7;
    const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(random() * xs.length)];
    const int = (lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1));
    const words = ['Ship', 'faster', 'with', 'layouts', 'that', 'simply', 'work', 'everywhere', 'today'];

    const problems: string[] = [];
    // Size limits and column spans on some layers.
    const limits = () => {
      const out: Record<string, number> = {};
      if (random() < 0.3) out.minWidth = int(20, 140);
      if (random() < 0.3) out.maxWidth = int(30, 200);
      if (random() < 0.2) out.minHeight = int(10, 80);
      if (random() < 0.2) out.maxHeight = int(20, 120);
      if (random() < 0.25) out.columnSpan = int(2, 3);
      return out;
    };
    for (let round = 0; round < 200; round++) {
      const base = createDocument();
      const frameProps = () => ({
        layout: pick(['row', 'column', 'row', 'column', 'grid'] as const),
        columns: int(1, 4),
        gap: int(0, 24),
        paddingTop: int(0, 24),
        paddingRight: int(0, 24),
        paddingBottom: int(0, 24),
        paddingLeft: int(0, 24),
        justify: pick(['start', 'center', 'end', 'space-between'] as const),
        align: pick(['start', 'center', 'end'] as const),
        wrap: random() < 0.35,
        stroke: random() < 0.3 ? '#000000' : null,
        strokeWidth: int(1, 4),
        fill: null,
        clip: false,
      });
      const root = createNode('frame', {
        ...frameProps(),
        widthMode: pick(['fixed', 'hug'] as const),
        heightMode: pick(['fixed', 'hug'] as const),
        width: int(200, 520),
        height: int(120, 360),
      });
      const ops: { type: 'create'; parentId: string; index: number; nodes: Node[] }[] = [
        { type: 'create', parentId: base.rootId, index: 0, nodes: [root] },
      ];
      const count = int(1, 7);
      for (let i = 0; i < count; i++) {
        const kind = pick(['rect', 'rect', 'ellipse', 'text', 'frame'] as const);
        const sizing = {
          widthMode: pick(['fixed', 'fixed', 'fill'] as const),
          heightMode: pick(['fixed', 'fixed', 'fill'] as const),
        };
        if (kind === 'rect' || kind === 'ellipse') {
          // Sometimes tiny and thickly outlined: a box never renders smaller than its border.
          const tiny = random() < 0.2;
          ops.push({
            type: 'create',
            parentId: root.id,
            index: i,
            nodes: [
              createNode(kind, {
                ...sizing,
                ...limits(),
                width: tiny ? int(0, 6) : int(10, 120),
                height: tiny ? int(0, 6) : int(10, 90),
                stroke: random() < 0.3 ? '#000000' : null,
                strokeWidth: int(1, 6),
              }),
            ],
          });
        } else if (kind === 'text') {
          const wrap = random() < 0.5;
          const text = Array.from({ length: int(1, 8) }, () => pick(words)).join(' ');
          ops.push({
            type: 'create',
            parentId: root.id,
            index: i,
            nodes: [
              createNode('text', {
                text,
                fontSize: int(12, 22),
                textResize: wrap ? 'auto-height' : 'auto-width',
                widthMode: wrap ? 'fill' : 'fixed',
                width: 100,
              }),
            ],
          });
        } else {
          // Usually hugging; sometimes a fixed size smaller than its own padding.
          const inner = createNode('frame', {
            ...frameProps(),
            ...sizing,
            ...limits(),
            widthMode: sizing.widthMode === 'fill' ? 'fill' : pick(['hug', 'hug', 'fixed'] as const),
            heightMode: pick(['hug', 'hug', 'fixed'] as const),
            width: int(0, 60),
            height: int(0, 40),
          });
          ops.push({ type: 'create', parentId: root.id, index: i, nodes: [inner] });
          for (let k = 0; k < int(1, 3); k++) {
            ops.push({
              type: 'create',
              parentId: inner.id,
              index: k,
              nodes: [createNode('rect', { width: int(10, 60), height: int(10, 40) })],
            });
          }
        }
      }
      let doc: Doc = applyOps(base, ops).doc;
      const extra = normalizeDocument(doc, new Set(Object.keys(doc.nodes)), base);
      doc = applyOps(doc, extra).doc;

      // Render the same tree with real flexbox.
      const host = document.createElement('div');
      host.style.cssText = 'position:absolute;left:-5000px;top:0;width:3000px;height:3000px';
      document.body.appendChild(host);
      const elements = new Map<string, HTMLElement>();
      const apply = (el: HTMLElement, decls: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(decls))
          if (v !== undefined) (el.style as unknown as Record<string, string>)[k] = String(v);
      };
      const render = (id: string, parent: HTMLElement, parentNode: Node | null) => {
        const n = doc.nodes[id];
        const el = document.createElement('div');
        el.style.boxSizing = 'border-box';
        apply(el, { ...css.appearanceDeclarations(n), transform: undefined });
        if (parentNode) apply(el, css.flexItemDeclarations(n, parentNode));
        else {
          apply(el, { position: 'absolute', left: '0px', top: '0px' });
          if (n.widthMode !== 'hug') el.style.width = `${n.width}px`;
          if (n.heightMode !== 'hug') el.style.height = `${n.height}px`;
        }
        if (n.type === 'frame') {
          apply(el, css.flexContainerDeclarations(n));
          if (n.layout !== 'none') el.style.position = el.style.position || 'relative';
        }
        if (n.type === 'text') el.textContent = n.text;
        parent.appendChild(el);
        elements.set(id, el);
        n.children.forEach((c: string) => render(c, el, n));
      };
      render(root.id, host, null);

      const border = (n: Node) => (n.type === 'frame' && n.stroke ? n.strokeWidth : 0);
      for (const [id, el] of elements) {
        const n = doc.nodes[id];
        const r = el.getBoundingClientRect();
        let x = 0;
        let y = 0;
        if (n.parentId && elements.has(n.parentId)) {
          const p = elements.get(n.parentId)!.getBoundingClientRect();
          const b = border(doc.nodes[n.parentId]);
          x = r.left - p.left - b;
          y = r.top - p.top - b;
        } else {
          x = n.x;
          y = n.y;
        }
        const tolerance = n.type === 'text' ? 1.01 : 0.51;
        const off = [
          ['x', x, n.x],
          ['y', y, n.y],
          ['width', r.width, n.width],
          ['height', r.height, n.height],
        ].filter(([, dom, model]) => Math.abs((dom as number) - (model as number)) > tolerance);
        if (off.length)
          problems.push(
            `round ${round} ${n.type} ${id}: ${off.map(([k, d, m]) => `${k} browser ${(d as number).toFixed(2)} vs engine ${(m as number).toFixed(2)}`).join(', ')}`,
          );
      }
      host.remove();
    }
    return problems;
  });

  expect(mismatches).toEqual([]);
});
