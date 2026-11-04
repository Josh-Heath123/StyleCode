import { isDefaultName, baseClassName, kebab, NameSet } from './names';
import { isAutoLayout, isGrid, isWrapping } from '../model/layout';
import {
  appearanceDeclarations,
  flexContainerDeclarations,
  flexItemDeclarations,
  fontStack,
  gridColumns,
  px,
  type CssDeclarations,
} from '../render/css';
import { MOBILE_BREAKPOINT, type DesignDocument, type DesignNode } from '../model/types';

/**
 * The first stage of code generation: a screen (a top-level frame) turned
 * into a tree of HTML elements, each with a class and a list of CSS
 * declarations. The HTML and React printers both work from this.
 *
 * Declarations come from the same mapping the canvas renders with
 * (`render/css.ts`), so at the design width the exported page lays out
 * exactly like the canvas. Below the design width a second set of rules
 * (`responsive`) lets rows wrap, fixed widths shrink and large type and
 * spacing scale down, instead of overflowing a phone screen. A third set
 * (`mobile`) applies on phones: the "On phones" settings, and grids that
 * drop to fewer columns.
 */

export interface Decl {
  prop: string;
  value: string;
}

export interface ElementNode {
  /** The layer this element comes from ('' for a wrapper the printer adds, such as a list item). */
  id: string;
  tag: string;
  className: string;
  attrs: [string, string][];
  /** Text content, printed as-is (whitespace is kept by `white-space: pre*`). */
  text?: string;
  /** Image asset to use as `src`; the printer decides the URL. */
  asset?: string;
  children: ElementNode[];
}

export interface Rule {
  nodeId: string;
  /** Class name, plus an optional pseudo-element such as `::placeholder`. */
  className: string;
  pseudo?: string;
  decls: Decl[];
  comment?: string;
}

export interface Warning {
  kind: 'free-layout' | 'outside-frames' | 'missing-image' | 'font';
  message: string;
  nodeIds: string[];
}

export interface Screen {
  id: string;
  name: string;
  /** File-name-safe name, e.g. `landing-page`. */
  slug: string;
  width: number;
  height: number;
  root: ElementNode;
  rules: Rule[];
  /** Rules that apply below the design width. */
  responsive: Rule[];
  /** Rules that apply on phones, below `phoneWidth`. */
  mobile: Rule[];
  /** Phones are narrower than this: the mobile breakpoint, or the design width if that is narrower. */
  phoneWidth: number;
  /** Image assets used, in order of first use. */
  assets: string[];
  /** Font families used, in order of first use. */
  fonts: string[];
  warnings: Warning[];
}

/** Fonts every system has, which need no font file. */
export const SYSTEM_FONTS = new Set(['system-ui', 'Arial', 'Georgia', 'Times New Roman', 'Courier New']);

/** Top-level frames: each one is a screen of the exported site. */
export function listScreens(doc: DesignDocument): DesignNode[] {
  return doc.nodes[doc.rootId].children.map((id) => doc.nodes[id]).filter((n) => n.type === 'frame' && n.visible);
}

/** The screen (visible top-level frame) a layer belongs to, if any. */
export function screenOf(doc: DesignDocument, id: string): string | null {
  let node: DesignNode | undefined = doc.nodes[id];
  while (node?.parentId && node.parentId !== doc.rootId) node = doc.nodes[node.parentId];
  return node && node.parentId === doc.rootId && node.type === 'frame' && node.visible ? node.id : null;
}

// ---------------------------------------------------------------------------
// Declarations
// ---------------------------------------------------------------------------

const ORDER = [
  'position',
  'left',
  'top',
  'display',
  'grid-template-columns',
  'grid-auto-rows',
  'grid-column',
  'flex-direction',
  'flex-wrap',
  'align-content',
  'justify-content',
  'align-items',
  'justify-items',
  'gap',
  'padding',
  'padding-left',
  'padding-right',
  'flex',
  'align-self',
  'justify-self',
  'width',
  'min-width',
  'max-width',
  'height',
  'min-height',
  'max-height',
  'aspect-ratio',
  'margin',
  'transform',
  'opacity',
  'background',
  'border',
  'border-radius',
  'overflow',
  'box-shadow',
  'backdrop-filter',
  '-webkit-backdrop-filter',
  'object-fit',
  'contain',
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'text-align',
  'white-space',
  'overflow-wrap',
];

const kebabProp = (key: string) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`).replace(/^webkit-/, '-webkit-');

/** Turns the shared mapping's declarations into ordered CSS declarations. */
function toDecls(...sets: CssDeclarations[]): Decl[] {
  const map = new Map<string, string>();
  for (const set of sets) {
    for (const [key, value] of Object.entries(set)) if (value !== undefined) map.set(kebabProp(key), String(value));
  }
  const rank = (prop: string) => {
    const i = ORDER.indexOf(prop);
    return i < 0 ? ORDER.length : i;
  };
  return [...map].map(([prop, value]) => ({ prop, value })).sort((a, b) => rank(a.prop) - rank(b.prop));
}

const get = (decls: Decl[], prop: string) => decls.find((d) => d.prop === prop)?.value;

/** Drops declarations that restate a default and shortens padding, for readable output. */
function tidy(decls: Decl[]): Decl[] {
  return decls
    .filter((d) => !(d.prop === 'text-align' && d.value === 'left'))
    .map((d) => {
      if (d.prop !== 'padding') return d;
      const [t, r, b, l] = d.value.split(' ');
      if (t === r && r === b && b === l) return { prop: d.prop, value: t };
      if (t === b && r === l) return { prop: d.prop, value: `${t} ${r}` };
      if (r === l) return { prop: d.prop, value: `${t} ${r} ${b}` };
      return d;
    });
}
const without = (decls: Decl[], ...props: string[]) => decls.filter((d) => !props.includes(d.prop));
const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Building a screen
// ---------------------------------------------------------------------------

/** Where an element sits, which limits what it may contain in valid HTML. */
interface Context {
  /** Only phrasing content allowed (inside a button, link, heading, paragraph…). */
  phrasing: boolean;
  /** Inside a button or link: no further buttons, links or inputs. */
  interactive: boolean;
  /** Direct child of a list. */
  inList: boolean;
}

const INTERACTIVE_TAGS = new Set(['button', 'a', 'input']);
const PHRASING_CONTAINERS = new Set(['button', 'a', 'span', 'label', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

export interface BuildOptions {
  /** Assets that exist in storage; image layers using anything else export as placeholders. */
  availableAssets?: ReadonlySet<string>;
}

export function buildScreen(doc: DesignDocument, frameId: string, options: BuildOptions = {}): Screen {
  const frame = doc.nodes[frameId];
  const names = new NameSet(['display-contents']);
  const rules: Rule[] = [];
  const responsive: Rule[] = [];
  const mobile: Rule[] = [];
  const phoneWidth = Math.min(MOBILE_BREAKPOINT, Math.round(frame.width));
  const assets: string[] = [];
  const fonts: string[] = [];
  const freeFrames: string[] = [];
  const missingImages: string[] = [];
  const designWidth = frame.width;

  // Headings get levels from their size: the largest heading text is h1, the next size h2…
  const headingSizes = new Set<number>();
  const collectHeadings = (id: string) => {
    const n = doc.nodes[id];
    if (!n.visible) return;
    if (n.role === 'heading') headingSizes.add(headingSize(doc, n));
    n.children.forEach(collectHeadings);
  };
  collectHeadings(frameId);
  const levels = [...headingSizes].sort((a, b) => b - a);
  const headingTag = (n: DesignNode) => `h${Math.min(6, levels.indexOf(headingSize(doc, n)) + 1)}`;

  const visibleChildren = (n: DesignNode) => n.children.map((c) => doc.nodes[c]).filter((c) => c.visible);
  const isAbsolute = (n: DesignNode, parent: DesignNode) => !isAutoLayout(parent) || n.positioning === 'absolute';
  const hasAbsoluteChildren = (n: DesignNode) => visibleChildren(n).some((c) => isAbsolute(c, n));

  const useFont = (family: string) => {
    if (!fonts.includes(family)) fonts.push(family);
  };

  /** The element for one layer, or null if it is hidden. */
  const build = (node: DesignNode, ctx: Context): ElementNode | null => {
    // A hidden screen isn't exported, but asking for it directly still gives its code.
    if (!node.visible && node.id !== frameId) return null;
    const parent = node.parentId ? doc.nodes[node.parentId] : undefined;
    const isRoot = node.id === frameId;
    const { tag, attrs, child } = chooseTag(node, ctx);
    const className = names.take(baseClassName(node));
    const element: ElementNode = { id: node.id, tag, className, attrs, children: [] };

    // Base declarations.
    const container = isAutoLayout(node) && tag !== 'input' ? flexContainerDeclarations(node) : {};
    let decls: Decl[];
    if (isRoot) {
      decls = toDecls(
        {
          position: 'relative',
          width: node.widthMode === 'hug' ? 'max-content' : '100%',
          maxWidth: node.widthMode === 'hug' ? undefined : px(node.width),
          minHeight: node.heightMode === 'hug' ? undefined : px(node.height),
          margin: '0 auto',
        },
        container,
        // The screen itself isn't rotated or clipped: the page scrolls instead.
        { ...appearanceDeclarations(node), transform: undefined, overflow: undefined },
      );
    } else if (parent && isAbsolute(node, parent)) {
      decls = toDecls(
        { position: 'absolute', left: px(node.x), top: px(node.y), width: px(node.width), height: px(node.height) },
        container,
        appearanceDeclarations(node),
      );
    } else {
      decls = toDecls(flexItemDeclarations(node, parent!), container, appearanceDeclarations(node));
      // Positioned siblings paint in document order, as on the canvas; otherwise `relative` is noise.
      if (!hasAbsoluteChildren(parent!) && !hasAbsoluteChildren(node)) decls = without(decls, 'position');
    }
    if (isRoot || hasAbsoluteChildren(node)) {
      if (!get(decls, 'position')) decls.unshift({ prop: 'position', value: 'relative' });
    }
    if (node.type === 'text') useFont(node.fontFamily);
    decls = tidy(decls);

    // Element-specific adjustments.
    if (tag === 'img') {
      if (node.src && (!options.availableAssets || options.availableAssets.has(node.src))) {
        element.asset = node.src;
        if (!assets.includes(node.src)) assets.push(node.src);
        decls = without(decls, 'overflow');
        decls.push({ prop: 'object-fit', value: node.fit });
        // A stretched image takes its height from the layout, not from its picture's proportions
        // (the canvas has no picture proportions to go by).
        if (get(decls, 'align-self') === 'stretch') decls.push({ prop: 'contain', value: 'size' });
      } else {
        // No picture to show: export the placeholder box the canvas shows.
        element.tag = ctx.phrasing ? 'span' : 'div';
        element.attrs = [
          ['role', 'img'],
          ['aria-label', isDefaultName(node.name) ? 'Image' : node.name],
        ];
        if (node.src) missingImages.push(node.id);
      }
    }
    if (node.type === 'text' && tag !== 'input') element.text = node.text;
    if (tag === 'input') {
      const source = node.type === 'text' ? node : visibleChildren(node).find((c) => c.type === 'text')!;
      decls = tidy(inputDeclarations(node, source, decls));
      element.attrs.push(['placeholder', source.text.replace(/\s+/g, ' ').trim()]);
      useFont(source.fontFamily);
      rules.push({
        nodeId: node.id,
        className,
        pseudo: '::placeholder',
        decls: [
          { prop: 'color', value: source.fill ?? 'transparent' },
          { prop: 'opacity', value: '1' },
        ],
      });
    }

    const rule: Rule = { nodeId: node.id, className, decls };
    if (node.type === 'frame' && node.layout === 'none' && visibleChildren(node).length) {
      freeFrames.push(node.id);
      rule.comment =
        'Free layout: the layers inside keep fixed positions at every width. Auto layout (Shift+A) makes this responsive.';
    }
    rules.splice(rules.length - (tag === 'input' ? 1 : 0), 0, rule);

    const flowCount = visibleChildren(node).filter((c) => !isAbsolute(c, node)).length;
    const adapt = responsiveDeclarations(node, parent, isRoot, decls, designWidth, element.tag, flowCount);
    if (adapt.length) responsive.push({ nodeId: node.id, className, decls: adapt });
    const phone = mobileDeclarations(node, parent, isRoot, decls, element.tag);
    if (phone.length) mobile.push({ nodeId: node.id, className, decls: phone });

    // Children.
    if (tag !== 'input') {
      for (const c of visibleChildren(node)) {
        const childElement = build(c, child);
        if (!childElement) continue;
        if (element.tag === 'ul' && childElement.tag !== 'li') {
          // A list holds list items; wrap anything else in one that doesn't affect layout.
          element.children.push({ id: '', tag: 'li', className: 'display-contents', attrs: [], children: [childElement] });
        } else {
          element.children.push(childElement);
        }
      }
    }
    return element;
  };

  /** Picks the HTML element for a layer from its role, type and context. */
  const chooseTag = (node: DesignNode, ctx: Context): { tag: string; attrs: [string, string][]; child: Context } => {
    const generic = ctx.phrasing ? 'span' : 'div';
    let tag = generic;
    const attrs: [string, string][] = [];
    const role = node.role;
    const textOnly = node.type === 'text';

    if (node.type === 'image') tag = 'img';
    else if (role === 'button' && !ctx.interactive) tag = 'button';
    else if (role === 'link' && !ctx.interactive) tag = 'a';
    else if (role === 'input' && !ctx.interactive && isInputLike(doc, node)) tag = 'input';
    else if (role === 'heading' && !ctx.phrasing) tag = headingTag(node);
    else if ((role === 'paragraph' || (role === 'auto' && textOnly)) && !ctx.phrasing) tag = 'p';
    else if (role === 'label') tag = 'span';
    else if (!ctx.phrasing) {
      if (role === 'nav' || role === 'header' || role === 'footer' || role === 'section') tag = role;
      else if (role === 'card') tag = 'article';
      else if (role === 'list' && !textOnly) tag = 'ul';
    }
    // Plain boxes and text in a list become its items; anything else (an image, a link) is wrapped.
    if (ctx.inList && (tag === 'div' || tag === 'p' || tag === 'article')) tag = 'li';
    if (role === 'image' && node.type !== 'image') {
      attrs.push(['role', 'img'], ['aria-label', isDefaultName(node.name) ? 'Image' : node.name]);
    }

    if (tag === 'button') attrs.push(['type', 'button']);
    if (tag === 'a') attrs.push(['href', '#']);
    if (tag === 'img') attrs.push(['alt', isDefaultName(node.name) ? '' : node.name]);
    if (tag === 'input') attrs.push(['type', 'text']);

    const child: Context = {
      phrasing: ctx.phrasing || PHRASING_CONTAINERS.has(tag),
      interactive: ctx.interactive || INTERACTIVE_TAGS.has(tag),
      inList: tag === 'ul',
    };
    return { tag, attrs, child };
  };

  const root = build(frame, { phrasing: false, interactive: false, inList: false })!;

  const warnings: Warning[] = [];
  if (freeFrames.length) {
    warnings.push({
      kind: 'free-layout',
      message:
        freeFrames[0] === frameId
          ? 'This screen uses free layout, so its layers keep fixed positions and won’t adapt to smaller screens. Select it and press Shift+A to tidy it into auto layout.'
          : `${freeFrames.length === 1 ? 'One frame uses' : `${freeFrames.length} frames use`} free layout, so the layers inside keep fixed positions at every width. Tidy ${freeFrames.length === 1 ? 'it' : 'them'} into auto layout (Shift+A) for responsive code.`,
      nodeIds: freeFrames,
    });
  }
  if (missingImages.length) {
    warnings.push({
      kind: 'missing-image',
      message: `${missingImages.length === 1 ? 'An image is' : `${missingImages.length} images are`} missing from this device, so ${missingImages.length === 1 ? 'it exports' : 'they export'} as a placeholder. Add the picture again to include it.`,
      nodeIds: missingImages,
    });
  }
  const custom = fonts.filter((f) => f !== 'Inter' && !SYSTEM_FONTS.has(f));
  if (custom.length) {
    warnings.push({
      kind: 'font',
      message: `${custom.join(', ')} ${custom.length === 1 ? 'is' : 'are'} not included in the export. Visitors need ${custom.length === 1 ? 'it' : 'them'} installed, or add a web font.`,
      nodeIds: [],
    });
  }

  return {
    id: frame.id,
    name: frame.name,
    slug: kebab(frame.name, 6) || 'screen',
    width: frame.width,
    height: frame.height,
    root,
    rules,
    responsive,
    mobile,
    phoneWidth,
    assets,
    fonts,
    warnings,
  };
}

/** The font size that decides a heading's level: its own, or the largest text inside it. */
function headingSize(doc: DesignDocument, node: DesignNode): number {
  if (node.type === 'text') return node.fontSize;
  let size = 0;
  const visit = (id: string) => {
    const n = doc.nodes[id];
    if (n.type === 'text' && n.visible) size = Math.max(size, n.fontSize);
    n.children.forEach(visit);
  };
  visit(node.id);
  return size;
}

/** An input is a text layer, or a frame holding a single text layer (its placeholder). */
function isInputLike(doc: DesignDocument, node: DesignNode): boolean {
  if (node.type === 'text') return true;
  if (node.type !== 'frame') return false;
  const kids = node.children.map((c) => doc.nodes[c]).filter((c) => c.visible);
  return kids.length === 1 && kids[0].type === 'text';
}

/** An `<input>` takes its box from the frame and its type style from the placeholder text. */
function inputDeclarations(node: DesignNode, text: DesignNode, decls: Decl[]): Decl[] {
  const out = without(
    decls,
    'display',
    'flex-direction',
    'flex-wrap',
    'align-content',
    'justify-content',
    'align-items',
    'gap',
    'grid-template-columns',
    'grid-auto-rows',
    'justify-items',
  );
  // Inputs have a size of their own; pin the designed size unless the layout stretches it.
  const fills = (prop: 'width' | 'height') =>
    get(out, 'flex') === '1 1 0' && get(out, prop === 'width' ? 'min-width' : 'min-height') === '0';
  if (!get(out, 'width') && !fills('width') && get(out, 'align-self') !== 'stretch')
    out.push({ prop: 'width', value: px(node.width) });
  if (!get(out, 'height') && !fills('height')) out.push({ prop: 'height', value: px(node.height) });
  // Padding only counts in auto layout, as on the canvas.
  if (isAutoLayout(node)) {
    const pad = [node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft];
    if (pad.some(Boolean) && !get(out, 'padding')) out.push({ prop: 'padding', value: pad.map(px).join(' ') });
  }
  const typography = toDecls({
    color: text.fill ?? 'transparent',
    fontFamily: fontStack(text.fontFamily),
    fontSize: px(text.fontSize),
    fontWeight: text.fontWeight,
    lineHeight: text.lineHeight,
    letterSpacing: text.letterSpacing ? px(text.letterSpacing) : undefined,
    textAlign: text.textAlign === 'left' ? undefined : text.textAlign,
  });
  return toDeclsKeepOrder([...out, ...typography]);
}

/**
 * Declarations that apply below the design width, so a layout made for a
 * wide screen adapts instead of overflowing: rows wrap, fixed widths become
 * maximums, single-line text may wrap, heights grow with their content, and
 * large type and horizontal spacing scale down with the viewport.
 */
function responsiveDeclarations(
  node: DesignNode,
  parent: DesignNode | undefined,
  isRoot: boolean,
  base: Decl[],
  designWidth: number,
  tag: string,
  flowCount: number,
): Decl[] {
  const out: Decl[] = [];
  const add = (prop: string, value: string) => out.push({ prop, value });
  const vw = (value: number) => `${round2((value / designWidth) * 100)}vw`;
  const absolute = get(base, 'position') === 'absolute';
  const inFlow = !isRoot && !absolute;

  if (isAutoLayout(node) && tag !== 'input') {
    if (node.layout === 'row' && !isWrapping(node) && flowCount > 1) add('flex-wrap', 'wrap');
    // Page-wide sections give up some of their side padding on small screens (never below 16px).
    if (isRoot || node.width >= designWidth / 2) {
      for (const side of ['left', 'right'] as const) {
        const value = side === 'left' ? node.paddingLeft : node.paddingRight;
        if (value > 16) add(`padding-${side}`, `clamp(16px, ${vw(value)}, ${px(value)})`);
        // Content never touches the edges of a small screen.
        else if (isRoot && value < 16) add(`padding-${side}`, '16px');
      }
    }
    if ((node.layout === 'row' || isGrid(node)) && node.gap >= 24 && flowCount > 1) {
      add('gap', `clamp(12px, ${vw(node.gap)}, ${px(node.gap)})`);
    }
  }
  if (inFlow) {
    // Only boxes wide enough to overflow a phone need a maximum.
    const width = get(base, 'width');
    // A frame that hugs its content is as wide as its content; let it shrink to the space there is.
    const hugging = isAutoLayout(node) && !width && get(base, 'flex') !== '1 1 0' && get(base, 'align-self') !== 'stretch';
    if ((width?.endsWith('px') && node.width > 160) || width === 'max-content' || hugging) add('max-width', '100%');
    // A layer that fills a row keeps a readable width, moving onto its own line when it can't.
    if (parent?.layout === 'row' && get(base, 'flex') === '1 1 0') add('min-width', 'min(100%, 240px)');
    const height = get(base, 'height');
    if (height?.endsWith('px')) {
      if (tag === 'img') {
        add('height', 'auto');
        add('aspect-ratio', `${round2(node.width)} / ${round2(node.height)}`);
      } else if (tag !== 'input' && (node.type === 'text' || isAutoLayout(node))) {
        add('height', 'auto');
        add('min-height', height);
      }
    }
  }
  // Headings and paragraphs stacked in a column may wrap when space runs out. Text in a row
  // is a label (a button, a link, a badge) and stays on one line.
  const prose = /^(p|h[1-6]|li)$/.test(tag) && parent?.layout === 'column';
  if (node.type === 'text' && get(base, 'white-space') === 'pre' && !absolute && prose) {
    add('white-space', 'pre-wrap');
    add('overflow-wrap', 'break-word');
    if (inFlow && !out.some((d) => d.prop === 'max-width')) add('max-width', '100%');
  }
  if (node.type === 'text' && node.fontSize >= 28 && !absolute) {
    const min = Math.max(20, Math.round(node.fontSize * 0.6));
    add('font-size', `clamp(${px(min)}, ${vw(node.fontSize)}, ${px(node.fontSize)})`);
  }
  return toDeclsKeepOrder(out);
}

/**
 * Declarations for phones: the layer's "On phones" settings (hide it, stack
 * a row, take the full width, other text size or alignment), and grids
 * dropping to their phone column count (one, unless set), with spanning
 * layers limited to what is there.
 */
function mobileDeclarations(
  node: DesignNode,
  parent: DesignNode | undefined,
  isRoot: boolean,
  base: Decl[],
  tag: string,
): Decl[] {
  const out: Decl[] = [];
  const add = (prop: string, value: string) => out.push({ prop, value });
  if (node.hideOnMobile && !isRoot) {
    add('display', 'none');
    return out;
  }
  const inFlow = !isRoot && get(base, 'position') !== 'absolute' && !!parent && isAutoLayout(parent);
  const phoneLayout = (n: DesignNode) =>
    (n.layout === 'row' || n.layout === 'column') && n.mobileLayout !== 'same' ? n.mobileLayout : n.layout;

  if (tag !== 'input') {
    if (isGrid(node)) {
      const columns = node.mobileColumns || 1;
      if (columns !== node.columns) add('grid-template-columns', gridColumns(columns));
    } else if (isAutoLayout(node) && phoneLayout(node) !== node.layout) {
      add('flex-direction', phoneLayout(node));
      if (phoneLayout(node) === 'column') add('flex-wrap', 'nowrap');
    }
  }
  if (inFlow && parent) {
    if (isGrid(parent)) {
      const columns = parent.mobileColumns || 1;
      const span = Math.min(parent.columns, Math.max(1, node.columnSpan));
      if (span > columns) add('grid-column', columns === 1 ? 'auto' : `span ${columns}`);
    } else if (phoneLayout(parent) !== parent.layout && get(base, 'flex') === '1 1 0') {
      // What shared the row's width takes the full width once stacked, and the other way round.
      add('flex', 'none');
      if (phoneLayout(parent) === 'column') {
        add('align-self', 'stretch');
        add('min-width', '0');
      }
    }
    if (node.mobileFill) {
      add('width', '100%');
      add('max-width', '100%');
      if (!isGrid(parent) && phoneLayout(parent) === 'row') add('flex', 'none');
    }
  }
  if (node.type === 'text') {
    if (node.mobileFontSize > 0) add('font-size', px(node.mobileFontSize));
    if (node.mobileTextAlign !== 'same') add('text-align', node.mobileTextAlign);
  }
  return toDeclsKeepOrder(out);
}

function toDeclsKeepOrder(decls: Decl[]): Decl[] {
  return toDecls(Object.fromEntries(decls.map((d) => [d.prop, d.value])) as CssDeclarations);
}
