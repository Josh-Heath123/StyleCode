import { describe, expect, it } from 'vitest';
import { applyOps } from '../model/ops';
import type { DesignDocument, NodeProps } from '../model/types';
import { reactAppFiles, staticSiteFiles } from './exporters';
import { buildDoc, settle, withBlock } from './fixtures';
import { declarationsText, screenCss, screenHtml } from './html';
import { declarationsToProps, editableDeclarations, parseDeclarationText } from './parseCss';
import { screenReact } from './react';
import { buildScreen, screenOf, type ElementNode } from './screen';
import { unzip, zip } from './zip';

const card = (n: number, color: string, title: string, props: Partial<NodeProps> = {}) => ({
  type: 'frame' as const,
  id: `card${n}`,
  props: {
    name: 'Feature card',
    role: 'card' as const,
    layout: 'column' as const,
    gap: 12,
    paddingTop: 20,
    paddingBottom: 20,
    paddingLeft: 20,
    paddingRight: 20,
    width: 300,
    heightMode: 'hug' as const,
    fill: '#ffffff',
    radius: 12,
    ...props,
  },
  children: [
    { type: 'ellipse' as const, id: `icon${n}`, props: { name: 'Icon', width: 24, height: 24, fill: color } },
    {
      type: 'text' as const,
      id: `title${n}`,
      props: { name: 'Title', role: 'heading' as const, text: title, fontSize: 18, fontWeight: 600 },
    },
    {
      type: 'text' as const,
      id: `body${n}`,
      props: {
        name: 'Body',
        text: 'Notes stay linked to their source.',
        textResize: 'auto-height' as const,
        widthMode: 'fill' as const,
      },
    },
  ],
});

/** A landing page with most kinds of layer, laid out like the canvas would. */
function landingPage(): DesignDocument {
  let doc = buildDoc(
    {
      type: 'frame',
      id: 'page',
      props: {
        name: 'Landing page',
        layout: 'column',
        gap: 48,
        paddingLeft: 80,
        paddingRight: 80,
        paddingTop: 40,
        paddingBottom: 64,
        width: 1280,
        height: 1000,
        fill: '#f6f7fb',
      },
      children: [
        {
          type: 'text',
          id: 'headline',
          props: {
            name: 'Headline',
            role: 'heading',
            text: 'Research notes that <organise> themselves',
            fontSize: 52,
            fontWeight: 700,
            lineHeight: 1.1,
          },
        },
        {
          type: 'image',
          id: 'hero',
          props: { name: 'Product shot', src: 'asset_aaaaaaaaaaaa', width: 640, height: 360, radius: 16 },
        },
        {
          type: 'frame',
          id: 'features',
          props: { name: 'Features', layout: 'row', gap: 24, widthMode: 'fill', heightMode: 'hug', fill: null, clip: false },
          children: [
            card(1, '#2f7bff', 'Tag as you go'),
            card(2, '#ff9f5a', 'Shared by default'),
            card(3, '#34c77b', 'Answers, not "folders"'),
          ],
        },
        {
          type: 'frame',
          id: 'free',
          props: { name: 'Sketch', width: 400, height: 200, fill: '#ffffff' },
          children: [
            {
              type: 'rect',
              id: 'blob',
              props: { name: 'Blob', x: 40, y: 30, width: 120, height: 80, rotation: 15, fill: '#2f7bff' },
            },
          ],
        },
      ],
    },
    { type: 'frame', id: 'mobile', props: { name: 'Mobile', layout: 'column', width: 390, height: 844, fill: '#ffffff' } },
  );
  doc = withBlock(doc, 'navigation', 'page');
  doc = withBlock(doc, 'text-field', 'page');
  doc = withBlock(doc, 'button', 'mobile');
  return doc;
}

const flat = (el: ElementNode): ElementNode[] => [el, ...el.children.flatMap(flat)];

describe('HTML and CSS', () => {
  it('chooses elements from roles and keeps HTML valid', () => {
    const screen = buildScreen(landingPage(), 'page');
    const els = flat(screen.root);
    const tag = (name: string) => els.find((e) => e.className === name)?.tag;
    expect(tag('headline')).toBe('h1');
    expect(tag('title')).toBe('h2');
    expect(tag('feature-card')).toBe('article');
    expect(tag('navigation')).toBe('nav');
    expect(tag('links')).toBe('ul');
    expect(tag('product')).toBe('a');
    expect(tag('sign-up-button')).toBe('button');
    expect(tag('input')).toBe('input');
    expect(tag('product-shot')).toBe('img');
    // Inside a button only phrasing content, and no nested interactive elements.
    const check = (el: ElementNode, phrasing: boolean, interactive: boolean) => {
      if (phrasing) expect(['div', 'p', 'h1', 'h2', 'ul', 'nav', 'article', 'section']).not.toContain(el.tag);
      if (interactive) expect(['a', 'button', 'input']).not.toContain(el.tag);
      const p = phrasing || ['button', 'a', 'span', 'p', 'h1', 'h2', 'h3'].includes(el.tag);
      el.children.forEach((c) => check(c, p, interactive || ['a', 'button'].includes(el.tag)));
    };
    check(screen.root, false, false);
    // A list only holds list items.
    for (const ul of els.filter((e) => e.tag === 'ul')) for (const li of ul.children) expect(li.tag).toBe('li');
  });

  it('escapes text and attributes', () => {
    const screen = buildScreen(landingPage(), 'page');
    const html = screenHtml(screen, { imageUrl: (a) => `assets/${a}.png`, stylesheets: ['base.css'] }).content;
    expect(html).toContain('Research notes that &lt;organise&gt; themselves');
    expect(html).toContain('Answers, not "folders"');
    expect(html).not.toContain('<organise>');
  });

  it('keeps responsive rules out of the design-width styles', () => {
    const screen = buildScreen(landingPage(), 'page');
    const css = screenCss(screen).content;
    const [base, media] = css.split('@media (max-width: 1279px)');
    expect(base).not.toMatch(/max-width: 100%|flex-wrap: wrap|clamp\(|min\(/);
    expect(media).toMatch(/\.features \{\n {4}flex-wrap: wrap;/);
    expect(media).toContain('font-size: clamp(31px, 4.06vw, 52px)');
    expect(media).toContain('aspect-ratio: 640 / 360');
  });

  it('flags free layout and maps every layer to its lines', () => {
    const screen = buildScreen(landingPage(), 'page');
    expect(screen.warnings.map((w) => w.kind)).toEqual(['free-layout']);
    expect(screen.warnings[0].nodeIds).toEqual(['free']);
    const html = screenHtml(screen, { imageUrl: () => 'x.png' });
    const lines = html.content.split('\n');
    const [[from, to]] = html.lines.get('features')!;
    expect(lines[from - 1]).toContain('class="features"');
    expect(lines[to - 1]).toContain('</div>');
    const css = screenCss(screen);
    const ranges = css.lines.get('features')!;
    expect(ranges).toHaveLength(2); // base rule and responsive rule
    expect(css.content.split('\n')[ranges[0][0] - 1]).toBe('.features {');
  });

  it('exports a missing image as a placeholder', () => {
    const screen = buildScreen(landingPage(), 'page', { availableAssets: new Set() });
    const hero = flat(screen.root).find((e) => e.id === 'hero')!;
    expect(hero.tag).toBe('div');
    expect(hero.attrs).toEqual([
      ['role', 'img'],
      ['aria-label', 'Product shot'],
    ]);
    expect(screen.warnings.map((w) => w.kind)).toContain('missing-image');
  });
});

describe('React', () => {
  it('turns repeated cards into one component with props', () => {
    const screen = buildScreen(landingPage(), 'page');
    const { tsx, css, componentName } = screenReact(screen, { imagePath: (a) => `../assets/${a}.png` });
    expect(componentName).toBe('LandingPage');
    expect(tsx.content).toContain('function FeatureCard({ iconBackground, title }: FeatureCardProps)');
    expect(tsx.content).toContain('<FeatureCard iconBackground="#2f7bff" title="Tag as you go" />');
    expect(tsx.content).toContain('title={"Answers, not \\"folders\\""}');
    // The shared body text stays a literal; the colour becomes a CSS variable.
    expect(tsx.content).toContain('<p className={s.body}>Notes stay linked to their source.</p>');
    expect(css.content).toContain('background: var(--icon-background);');
    expect(css.content).not.toContain('.featureCard2');
    expect(css.content).toContain('body:has(.landingPage)');
  });

  it('leaves a structure used once inline', () => {
    const doc = buildDoc({
      type: 'frame',
      id: 'p',
      props: { name: 'Page', layout: 'column' },
      children: [card(1, '#000000', 'Only one')],
    });
    const { tsx } = screenReact(buildScreen(doc, 'p'), { imagePath: (a) => a });
    expect(tsx.content).not.toContain('function FeatureCard');
  });
});

describe('generated code is pinned', () => {
  // Any change to generated code shows up here as a snapshot diff to review.
  it('for a landing page', () => {
    const screen = buildScreen(landingPage(), 'page');
    const react = screenReact(screen, { imagePath: (a) => `../assets/${a}.jpg` });
    expect(
      screenHtml(screen, { imageUrl: (a) => `assets/${a}.jpg`, stylesheets: ['base.css', 'landing-page.css'] }).content,
    ).toMatchSnapshot('html');
    expect(screenCss(screen).content).toMatchSnapshot('css');
    expect(react.tsx.content).toMatchSnapshot('tsx');
    expect(react.css.content).toMatchSnapshot('module css');
  });
});

describe('editing CSS', () => {
  it('reads every layer’s own CSS back into the same design', () => {
    const doc = landingPage();
    for (const frame of ['page', 'mobile']) {
      const screen = buildScreen(doc, frame);
      for (const rule of screen.rules) {
        const node = doc.nodes[rule.nodeId];
        if (rule.pseudo || flat(screen.root).find((e) => e.id === node.id)?.tag === 'input') continue;
        const shown = editableDeclarations(rule.decls, { screen: node.id === frame, type: node.type });
        const text = shown.map((d) => `${d.prop}: ${d.value};`).join('\n');
        const parsed = parseDeclarationText(text);
        expect(parsed.errors).toEqual([]);
        const inFlow = !rule.decls.some((d) => d.prop === 'position' && d.value === 'absolute') && node.id !== frame;
        // Nothing shown as before counts as a change, so apply everything to test the parser.
        const result = declarationsToProps(node, parsed.decls, [], { inFlow });
        expect(result, `${node.name}`).toMatchObject({ ok: true });
        if (!result.ok) continue;
        const updated = settle(applyOps(doc, [{ type: 'update', id: node.id, props: result.props }]).doc);
        const again = buildScreen(updated, frame).rules.find((r) => r.nodeId === node.id && !r.pseudo)!;
        expect(again.decls, node.name).toEqual(rule.decls);
      }
    }
  });

  it('applies edits and reports what it can’t represent', () => {
    const doc = landingPage();
    const node = doc.nodes.card1;
    const ok = declarationsToProps(
      node,
      parseDeclarationText(
        'padding: 8px 16px; background: linear-gradient(90deg, #ff0000, #0000ff); border: 2px solid #000; box-shadow: none',
      ).decls,
      [{ prop: 'border-radius', value: '12px' }],
    );
    expect(ok).toEqual({
      ok: true,
      props: {
        paddingTop: 8,
        paddingRight: 16,
        paddingBottom: 8,
        paddingLeft: 16,
        fill: '#ff0000',
        gradientTo: '#0000ff',
        gradientAngle: 90,
        stroke: '#000000',
        strokeWidth: 2,
        shadowColor: null,
        radius: 0,
      },
    });
    const bad = declarationsToProps(
      node,
      parseDeclarationText('filter: blur(2px); position: absolute; border: 1px dashed #000; background: banana').decls,
      [],
    );
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.errors).toHaveLength(4);
    expect(bad.errors[0]).toContain('isn’t supported');
    expect(bad.errors[1]).toContain('set by StyleCode');
  });
});

describe('exports', () => {
  const images = new Map([['asset_aaaaaaaaaaaa', { type: 'image/jpeg', data: new Uint8Array([1, 2, 3]) }]]);
  const fonts = new Map([
    ['inter-latin-wght-normal.woff2', new Uint8Array([4])],
    ['inter-latin-ext-wght-normal.woff2', new Uint8Array([5])],
  ]);

  it('writes a static site with one page per screen', () => {
    const files = staticSiteFiles({ doc: landingPage(), images, fonts });
    expect(files.map((f) => f.path).sort()).toEqual([
      'README.md',
      'assets/asset_aaaaaaaaaaaa.jpg',
      'assets/fonts/inter-latin-ext-wght-normal.woff2',
      'assets/fonts/inter-latin-wght-normal.woff2',
      'base.css',
      'index.html',
      'landing-page.css',
      'mobile.css',
      'mobile.html',
    ]);
    const index = files.find((f) => f.path === 'index.html')!.content as string;
    expect(index).toContain('<link rel="stylesheet" href="landing-page.css">');
    expect(index).toContain('src="assets/asset_aaaaaaaaaaaa.jpg"');
    expect(files.find((f) => f.path === 'base.css')!.content).toContain("src: url('assets/fonts/inter-latin-wght-normal.woff2')");
  });

  it('writes a React app that switches screens by address', () => {
    const files = reactAppFiles({ doc: landingPage(), images, fonts });
    const paths = files.map((f) => f.path);
    expect(paths).toContain('src/screens/LandingPage.tsx');
    expect(paths).toContain('src/screens/Mobile.module.css');
    expect(paths).toContain('src/assets/asset_aaaaaaaaaaaa.jpg');
    const app = files.find((f) => f.path === 'src/App.tsx')!.content as string;
    expect(app).toContain("'landing-page': LandingPage,");
    expect(app).toContain('mobile: Mobile,'.replace('mobile:', "'mobile':"));
    const pkg = JSON.parse(files.find((f) => f.path === 'package.json')!.content as string);
    expect(pkg.name).toBe('test');
    expect(Object.keys(pkg.dependencies)).toEqual(['react', 'react-dom']);
  });

  it('round-trips files through a ZIP', () => {
    const files = [
      { path: 'a/index.html', content: '<p>héllo</p>' },
      { path: 'a/img.bin', content: new Uint8Array([0, 255, 7]) },
    ];
    const back = unzip(zip(files));
    expect(back.map((f) => f.path)).toEqual(['a/index.html', 'a/img.bin']);
    expect(new TextDecoder().decode(back[0].content)).toBe('<p>héllo</p>');
    expect([...back[1].content]).toEqual([0, 255, 7]);
  });
});

describe('review fixes', () => {
  const text = (id: string, content: string, props: Partial<NodeProps> = {}) => ({
    type: 'text' as const,
    id,
    props: { text: content, ...props },
  });

  it('builds a hidden screen without crashing, but doesn\u2019t list it', () => {
    const doc = buildDoc({ type: 'frame', id: 'p', props: { name: 'Page', visible: false }, children: [text('t', 'Hi')] });
    expect(screenOf(doc, 't')).toBeNull();
    expect(() => screenHtml(buildScreen(doc, 'p'), { imageUrl: (a) => a })).not.toThrow();
  });

  it('keeps component props from hiding the stylesheet or using reserved words', () => {
    const button = (id: string, label: string) => ({
      type: 'frame' as const,
      id,
      props: {
        name: 'Size',
        role: 'button' as const,
        layout: 'row' as const,
        widthMode: 'hug' as const,
        heightMode: 'hug' as const,
        paddingLeft: 8,
        paddingRight: 8,
      },
      children: [text(`${id}t`, label, { name: label })],
    });
    const doc = buildDoc({
      type: 'frame',
      id: 'p',
      props: { name: 'Page', layout: 'row' },
      children: [button('a', 'S'), button('b', 'M'), button('c', 'Continue')],
    });
    const { tsx } = screenReact(buildScreen(doc, 'p'), { imagePath: (a) => a });
    expect(tsx).toBeDefined();
    expect(tsx.content).toMatch(/function Size\(\{ text \}: SizeProps\)/);
    // Text layers that share a name give the prop that name, unless it would clash.
    for (const [layer, prop] of [
      ['S', 'sValue'],
      ['Continue', 'continueValue'],
      ['Image1', 'image1Value'],
    ]) {
      const named = buildDoc({
        type: 'frame',
        id: 'p',
        props: { name: 'Page', layout: 'row' },
        children: [button('a', 'One'), button('b', 'Two')].map((b) => ({
          ...b,
          children: [{ ...b.children[0], props: { ...b.children[0].props, name: layer } }],
        })),
      });
      const out = screenReact(buildScreen(named, 'p'), { imagePath: (a) => a }).tsx.content;
      expect(out, layer).toContain(`function Size({ ${prop} }: SizeProps)`);
    }
  });

  it('gives screens file and component names that don\u2019t clash', () => {
    const doc = buildDoc(
      { type: 'frame', id: 'a', props: { name: 'Home' } },
      { type: 'frame', id: 'b', props: { name: 'Index' } },
      { type: 'frame', id: 'c', props: { name: 'Base' } },
      { type: 'frame', id: 'd', props: { name: 'App' } },
    );
    const input = { doc, images: new Map(), fonts: new Map() };
    const site = staticSiteFiles(input).map((f) => f.path);
    expect(new Set(site).size).toBe(site.length);
    expect(site).toEqual(expect.arrayContaining(['index.html', 'index-2.html', 'base-2.html', 'base.css']));
    const app = reactAppFiles(input);
    const appTsx = app.find((f) => f.path === 'src/App.tsx')!.content as string;
    expect(appTsx).toContain("import App2 from './screens/App2';");
    expect(appTsx).toContain('Object.hasOwn(screens, name)');
  });

  it('keeps names from ending CSS comments', () => {
    const doc = buildDoc({ type: 'frame', id: 'p', props: { name: 'Pricing */ body { display: none } /*' } });
    expect(screenCss(buildScreen(doc, 'p')).content).not.toContain('*/ body');
  });

  it('wraps an image in a list instead of dropping it', () => {
    const doc = buildDoc({
      type: 'frame',
      id: 'p',
      props: { name: 'Page', layout: 'column' },
      children: [
        {
          type: 'frame',
          id: 'list',
          props: { name: 'Gallery', role: 'list', layout: 'row' },
          children: [{ type: 'image', id: 'img', props: { name: 'Photo', role: 'list-item', src: 'asset_aaaaaaaaaaaa' } }],
        },
      ],
    });
    const html = screenHtml(buildScreen(doc, 'p'), { imageUrl: (a) => `${a}.png` }).content;
    expect(html).toMatch(/<li class="display-contents">\s*<img class="photo" src="asset_aaaaaaaaaaaa.png"/);
  });

  it('exports images in formats browsers can\u2019t show as placeholders', () => {
    const doc = buildDoc({
      type: 'frame',
      id: 'p',
      props: { name: 'Page', layout: 'column' },
      children: [{ type: 'image', id: 'img', props: { src: 'asset_aaaaaaaaaaaa' } }],
    });
    const files = staticSiteFiles({
      doc,
      images: new Map([['asset_aaaaaaaaaaaa', { type: 'image/tiff', data: new Uint8Array([1]) }]]),
      fonts: new Map(),
    });
    expect(files.some((f) => f.path.startsWith('assets/asset_'))).toBe(false);
    expect(files.find((f) => f.path === 'index.html')!.content).toContain('role="img"');
  });

  it('keeps & literal in React props', () => {
    const card = (id: string, label: string) => ({
      type: 'frame' as const,
      id,
      props: { name: 'Tag', layout: 'row' as const, widthMode: 'hug' as const, heightMode: 'hug' as const },
      children: [
        text(`${id}t`, label, { name: 'Label' }),
        { type: 'rect' as const, id: `${id}r`, props: { width: 4, height: 4 } },
      ],
    });
    const doc = buildDoc({
      type: 'frame',
      id: 'p',
      props: { name: 'Page', layout: 'row' },
      children: [card('a', 'Use &lt;b&gt;'), card('b', 'Plain')],
    });
    const { tsx } = screenReact(buildScreen(doc, 'p'), { imagePath: (a) => a });
    expect(tsx.content).toContain('label={"Use &lt;b&gt;"}');
  });

  it('only pads inputs in auto layout, as the canvas does', () => {
    const input = (layout: 'none' | 'row') => ({
      type: 'frame' as const,
      id: `in-${layout}`,
      props: { name: 'Field', role: 'input' as const, layout, paddingLeft: 12, paddingRight: 12, width: 200, height: 40 },
      children: [text(`t-${layout}`, 'Email', { x: 0, y: 0 })],
    });
    const doc = buildDoc({
      type: 'frame',
      id: 'p',
      props: { name: 'Page', layout: 'column' },
      children: [input('none'), input('row')],
    });
    const rules = buildScreen(doc, 'p').rules;
    const padding = (id: string) => rules.find((r) => r.nodeId === id && !r.pseudo)!.decls.find((d) => d.prop === 'padding');
    expect(padding('in-none')).toBeUndefined();
    expect(padding('in-row')?.value).toBe('0px 12px');
  });

  it('applies only the declarations that changed', () => {
    const doc = buildDoc({ type: 'frame', id: 'p', props: { name: 'Page' }, children: [text('t', 'Hello', { x: 10, y: 10 })] });
    const rule = buildScreen(doc, 'p').rules.find((r) => r.nodeId === 't')!;
    const shown = editableDeclarations(rule.decls, { type: 'text' });
    const edited = parseDeclarationText(declarationsText(shown).replace('color: #11141a', 'color: #ff0000')).decls;
    expect(declarationsToProps(doc.nodes.t, edited, shown)).toEqual({ ok: true, props: { fill: '#ff0000' } });
  });

  it('lets a placeholder image be edited without touching clipping', () => {
    const doc = buildDoc({
      type: 'frame',
      id: 'p',
      props: { name: 'Page' },
      children: [{ type: 'image', id: 'img', props: { x: 0, y: 0 } }],
    });
    const rule = buildScreen(doc, 'p').rules.find((r) => r.nodeId === 'img')!;
    expect(editableDeclarations(rule.decls, { type: 'image' }).map((d) => d.prop)).not.toContain('overflow');
  });

  it('stops a stretched image from sizing itself by its picture', () => {
    const doc = buildDoc({
      type: 'frame',
      id: 'p',
      props: { name: 'Page', layout: 'row', wrap: true, width: 600, height: 300 },
      children: [{ type: 'image', id: 'img', props: { heightMode: 'fill', src: 'asset_aaaaaaaaaaaa' } }],
    });
    const rule = buildScreen(doc, 'p').rules.find((r) => r.nodeId === 'img')!;
    expect(rule.decls).toContainEqual({ prop: 'contain', value: 'size' });
  });
});
