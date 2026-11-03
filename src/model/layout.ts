import { contentOffset } from './geometry';
import type { Op } from './ops';
import type { DesignDocument, DesignNode, NodeProps } from './types';

/**
 * The auto-layout engine.
 *
 * Auto-layout frames arrange their children like CSS flexbox: a row or
 * column with gap, padding, distribution (justify) and alignment, and
 * children that are fixed size, hug their content or fill the space left.
 *
 * Layout is resolved here, in the model, and written back as ordinary x/y/
 * width/height values. That keeps one consistent geometry for the canvas,
 * the selection overlay, hit-testing, the AI context and undo. Exported code
 * expresses the same layout with real flexbox (see `render/css.ts`); a
 * browser test checks the two agree.
 *
 * Supported subset, matching CSS exactly:
 * - `flex-direction: row | column`, `gap`, `padding`
 * - `justify-content: flex-start | center | flex-end | space-between`
 * - `align-items: flex-start | center | flex-end`, plus `align-self: stretch` (fill across)
 * - children `flex: none` (fixed or hug) or `flex: 1 1 0; min-width: 0` (fill along)
 * - no wrapping; transforms (rotation) do not affect layout, as in CSS
 */

/** Measures a text layer: its natural size, or its height when wrapped at `width`. */
export type TextMeasure = (node: DesignNode, width?: number) => { width: number; height: number };

type Axis = 'width' | 'height';
type Size = { width: number; height: number };
type Box = { x: number; y: number; width: number; height: number };

export function isAutoLayout(node: DesignNode | undefined): boolean {
  return !!node && node.type === 'frame' && node.layout !== 'none';
}

/** Whether a layer is positioned by its parent's auto-layout rather than its own x/y. */
export function isInFlow(doc: DesignDocument, node: DesignNode | undefined): boolean {
  if (!node?.parentId) return false;
  return isAutoLayout(doc.nodes[node.parentId]) && node.visible && node.positioning !== 'absolute';
}

/** Whether an auto-layout frame sizes itself to its content along an axis. */
export function hugs(node: DesignNode | undefined, axis: Axis): boolean {
  return !!node && isAutoLayout(node) && (axis === 'width' ? node.widthMode : node.heightMode) === 'hug';
}

/**
 * Whether a layer can fill its parent along an axis: only inside an
 * auto-layout parent whose size along that axis is decided by something else
 * (a parent that hugs its content has no space to fill).
 */
export function canFill(node: DesignNode, axis: Axis, parent: DesignNode | undefined): boolean {
  return isAutoLayout(parent) && node.positioning !== 'absolute' && !hugs(parent, axis);
}

/**
 * How a layer's size is decided along one axis, with text resizing folded
 * in: auto-width text hugs its width, auto-height text hugs its height. A
 * layer set to fill where it cannot (see `canFill`) keeps its stored size.
 */
export function effectiveSizing(node: DesignNode, axis: Axis, parent: DesignNode | undefined): 'fixed' | 'hug' | 'fill' {
  const mode = axis === 'width' ? node.widthMode : node.heightMode;
  if (mode === 'fill' && canFill(node, axis, parent)) return 'fill';
  if (node.type === 'text') {
    if (axis === 'width') return node.textResize === 'auto-width' ? 'hug' : 'fixed';
    return node.textResize === 'fixed' ? 'fixed' : 'hug';
  }
  if (mode === 'hug' && isAutoLayout(node)) return 'hug';
  return 'fixed';
}

/**
 * The smallest a layer can be along an axis: its border (a stroke draws as a
 * CSS border) plus, for auto-layout frames, its padding. With
 * `box-sizing: border-box` a box never renders smaller than that, so the
 * model never records a smaller size either.
 */
export function minSize(node: DesignNode, axis: Axis): number {
  const border = node.type !== 'text' && node.stroke && node.strokeWidth > 0 ? node.strokeWidth * 2 : 0;
  if (!isAutoLayout(node)) return border;
  return border + (axis === 'width' ? node.paddingLeft + node.paddingRight : node.paddingTop + node.paddingBottom);
}

/**
 * The auto-layout frames whose layout a change can affect: for each touched
 * layer (and the parent it was removed from), the outermost frame of the
 * unbroken chain of auto-layout ancestors. Laying out that frame lays out
 * everything inside it.
 */
export function layoutRoots(doc: DesignDocument, touched: Iterable<string>, base?: DesignDocument): string[] {
  const candidates = new Set<string>();
  for (const id of touched) {
    const node = doc.nodes[id];
    if (node) {
      candidates.add(id);
      if (node.parentId) candidates.add(node.parentId);
    }
    const before = base?.nodes[id];
    if (before?.parentId && doc.nodes[before.parentId]) candidates.add(before.parentId);
  }
  const roots = new Set<string>();
  for (const id of candidates) {
    let root: string | null = isAutoLayout(doc.nodes[id]) ? id : null;
    let current = id;
    for (;;) {
      const parentId = doc.nodes[current]?.parentId;
      if (!parentId || !isAutoLayout(doc.nodes[parentId])) break;
      root = parentId;
      current = parentId;
    }
    if (root) roots.add(root);
  }
  // Drop roots nested inside other roots.
  return [...roots].filter((id) => {
    let parentId = doc.nodes[id].parentId;
    while (parentId) {
      if (roots.has(parentId)) return false;
      parentId = doc.nodes[parentId]?.parentId ?? null;
    }
    return true;
  });
}

class LayoutRun {
  readonly out = new Map<string, Box>();

  constructor(
    private readonly doc: DesignDocument,
    private readonly measure: TextMeasure,
  ) {}

  box(id: string): Box {
    const existing = this.out.get(id);
    if (existing) return existing;
    const n = this.doc.nodes[id];
    return { x: n.x, y: n.y, width: n.width, height: n.height };
  }

  private set(id: string, patch: Partial<Box>): void {
    this.out.set(id, { ...this.box(id), ...patch });
  }

  /**
   * Resolves a layer's size, optionally with one or both dimensions imposed by
   * its parent, and lays out its subtree if it is an auto-layout frame.
   */
  size(id: string, assigned: Partial<Size>): Size {
    const node = this.doc.nodes[id];
    if (isAutoLayout(node)) return this.frame(node, assigned);

    const current = this.box(id);
    let width: number;
    let height: number;
    if (node.type === 'text') {
      if (assigned.width !== undefined) {
        width = assigned.width;
        height = assigned.height ?? (node.textResize === 'fixed' ? current.height : this.measure(node, width).height);
      } else if (node.textResize === 'auto-width') {
        const natural = this.measure(node);
        width = natural.width;
        height = assigned.height ?? natural.height;
      } else {
        width = current.width;
        height = assigned.height ?? (node.textResize === 'fixed' ? current.height : this.measure(node, width).height);
      }
    } else {
      width = assigned.width ?? current.width;
      height = assigned.height ?? current.height;
    }
    width = Math.max(minSize(node, 'width'), width);
    height = Math.max(minSize(node, 'height'), height);
    this.set(id, { width, height });
    return { width, height };
  }

  private frame(node: DesignNode, assigned: Partial<Size>): Size {
    const row = node.layout === 'row';
    const mainKey: Axis = row ? 'width' : 'height';
    const crossKey: Axis = row ? 'height' : 'width';
    const mainPos = row ? 'x' : 'y';
    const crossPos = row ? 'y' : 'x';
    const padMainStart = row ? node.paddingLeft : node.paddingTop;
    const padMainEnd = row ? node.paddingRight : node.paddingBottom;
    const padCrossStart = row ? node.paddingTop : node.paddingLeft;
    const padCrossEnd = row ? node.paddingBottom : node.paddingRight;
    const border = contentOffset(node) * 2;
    const current = this.box(node.id);

    const own = (axis: Axis): number | undefined => {
      const mode = axis === 'width' ? node.widthMode : node.heightMode;
      const size = assigned[axis] ?? (mode === 'hug' ? undefined : current[axis]);
      return size === undefined ? undefined : Math.max(size, minSize(node, axis));
    };
    const ownMain = own(mainKey);
    const ownCross = own(crossKey);
    const innerOf = (outer: number, start: number, end: number) => Math.max(0, outer - border - start - end);

    const visible = node.children.map((id) => this.doc.nodes[id]).filter((child) => child.visible);
    // Layers that ignore the flow keep their own size and position, but one that is an
    // auto-layout frame still lays out its own contents.
    for (const child of visible) if (child.positioning === 'absolute') this.size(child.id, {});
    const items = visible
      .filter((child) => child.positioning !== 'absolute')
      .map((child) => ({
        id: child.id,
        mainMode: effectiveSizing(child, mainKey, node),
        crossMode: effectiveSizing(child, crossKey, node),
        main: 0,
        cross: 0,
      }));

    const knownInnerCross = ownCross === undefined ? undefined : innerOf(ownCross, padCrossStart, padCrossEnd);
    const sizeItem = (item: (typeof items)[number], main: number | undefined, cross: number | undefined) => {
      const s = this.size(item.id, { [mainKey]: main, [crossKey]: cross });
      item.main = s[mainKey];
      item.cross = s[crossKey];
    };
    const stretch = (item: (typeof items)[number]) => (item.crossMode === 'fill' ? knownInnerCross : undefined);

    // 1. Children that keep their own main size.
    for (const item of items) if (item.mainMode !== 'fill') sizeItem(item, undefined, stretch(item));

    // 2. Children that fill the main axis share whatever is left.
    const gaps = node.gap * Math.max(0, items.length - 1);
    const fills = items.filter((item) => item.mainMode === 'fill');
    let finalMain: number;
    if (ownMain === undefined) {
      // A hugging frame has no fill children (they are treated as fixed), so it just adds up.
      finalMain = items.reduce((sum, item) => sum + item.main, 0) + gaps + padMainStart + padMainEnd + border;
    } else {
      finalMain = ownMain;
      // As in CSS (flex: 1 1 0), a filling layer never shrinks below its own padding and border;
      // the space left after those is shared equally.
      const used = items.filter((item) => item.mainMode !== 'fill').reduce((sum, item) => sum + item.main, 0);
      const bases = fills.map((item) => minSize(this.doc.nodes[item.id], mainKey));
      const free = innerOf(ownMain, padMainStart, padMainEnd) - used - gaps - bases.reduce((a, b) => a + b, 0);
      const share = fills.length ? Math.max(0, free) / fills.length : 0;
      fills.forEach((item, i) => sizeItem(item, bases[i] + share, stretch(item)));
    }

    // 3. Cross size: hugging frames fit their tallest (or widest) child.
    const finalCross = ownCross ?? Math.max(0, ...items.map((item) => item.cross)) + padCrossStart + padCrossEnd + border;

    // 4. Positions, relative to the padding box (inside the frame's border).
    const innerMain = innerOf(finalMain, padMainStart, padMainEnd);
    const innerCross = innerOf(finalCross, padCrossStart, padCrossEnd);
    const total = items.reduce((sum, item) => sum + item.main, 0);
    const free = innerMain - total - gaps;
    let cursor = padMainStart;
    let spacing = node.gap;
    if (node.justify === 'center') cursor += free / 2;
    else if (node.justify === 'end') cursor += free;
    else if (node.justify === 'space-between' && items.length > 1 && free > 0) spacing += free / (items.length - 1);

    for (const item of items) {
      let crossAt = padCrossStart;
      if (item.crossMode !== 'fill') {
        if (node.align === 'center') crossAt += (innerCross - item.cross) / 2;
        else if (node.align === 'end') crossAt += innerCross - item.cross;
      }
      this.set(item.id, { [mainPos]: cursor, [crossPos]: crossAt });
      cursor += item.main + spacing;
    }

    const size = { [mainKey]: Math.max(0, finalMain), [crossKey]: Math.max(0, finalCross) } as Size;
    this.set(node.id, size);
    return size;
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Grows any of the given layers that are smaller than their border and padding allow (see `minSize`). */
export function minSizeOps(doc: DesignDocument, ids: Iterable<string>): Op[] {
  const ops: Op[] = [];
  for (const id of ids) {
    const node = doc.nodes[id];
    if (!node || node.type === 'page') continue;
    const props: Partial<NodeProps> = {};
    const minW = minSize(node, 'width');
    const minH = minSize(node, 'height');
    if (node.width < minW) props.width = minW;
    if (node.height < minH) props.height = minH;
    if (Object.keys(props).length) ops.push({ type: 'update', id, props });
  }
  return ops;
}

/**
 * Lays out the given auto-layout frames and returns the updates needed to
 * bring every affected layer to its computed position and size.
 */
export function layoutOps(doc: DesignDocument, roots: readonly string[], measure: TextMeasure): Op[] {
  const run = new LayoutRun(doc, measure);
  for (const id of roots) if (isAutoLayout(doc.nodes[id])) run.size(id, {});

  const ops: Op[] = [];
  for (const [id, box] of run.out) {
    const node = doc.nodes[id];
    const props: Partial<NodeProps> = {};
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      const value = round2(box[key]);
      if (Math.abs(value - node[key]) > 0.005) props[key] = value;
    }
    if (Object.keys(props).length) ops.push({ type: 'update', id, props });
  }
  return ops;
}
