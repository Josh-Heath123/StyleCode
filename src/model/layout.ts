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
 * - rows with `flex-wrap: wrap` and `align-content` matching `align-items`
 * - transforms (rotation) do not affect layout, as in CSS
 */

/** Measures a text layer: its natural size, or its height when wrapped at `width`. */
export type TextMeasure = (node: DesignNode, width?: number) => { width: number; height: number };

type Axis = 'width' | 'height';
type Size = { width: number; height: number };
type Box = { x: number; y: number; width: number; height: number };

export function isAutoLayout(node: DesignNode | undefined): boolean {
  return !!node && node.type === 'frame' && node.layout !== 'none';
}

/** Whether an auto-layout frame moves children that don't fit onto new lines. Only rows wrap. */
export function isWrapping(node: DesignNode | undefined): boolean {
  return !!node && node.type === 'frame' && node.layout === 'row' && node.wrap;
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
   *
   * `natural` asks for the size a layer would have along that axis if nothing
   * set it (CSS `auto`): its content for frames and text, its border for
   * shapes. Wrapping rows need it to find how tall each line is before
   * stretching the layers in it.
   */
  size(id: string, assigned: Partial<Size>, natural?: Axis): Size {
    const node = this.doc.nodes[id];
    if (isAutoLayout(node)) return this.frame(node, assigned, natural);

    const current = this.box(id);
    let width: number;
    let height: number;
    if (node.type === 'text') {
      const fixedHeight = node.textResize === 'fixed' && natural !== 'height';
      if (assigned.width !== undefined) {
        width = assigned.width;
        height = assigned.height ?? (fixedHeight ? current.height : this.measure(node, width).height);
      } else if (node.textResize === 'auto-width') {
        const size = this.measure(node);
        width = size.width;
        height = assigned.height ?? size.height;
      } else {
        width = current.width;
        height = assigned.height ?? (fixedHeight ? current.height : this.measure(node, width).height);
      }
    } else {
      // A shape has no content, so its natural size is just its border.
      width = assigned.width ?? (natural === 'width' ? 0 : current.width);
      height = assigned.height ?? (natural === 'height' ? 0 : current.height);
    }
    width = Math.max(minSize(node, 'width'), width);
    height = Math.max(minSize(node, 'height'), height);
    this.set(id, { width, height });
    return { width, height };
  }

  private frame(node: DesignNode, assigned: Partial<Size>, natural?: Axis): Size {
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
      const size = assigned[axis] ?? (mode === 'hug' || axis === natural ? undefined : current[axis]);
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

    if (isWrapping(node)) {
      const pads = { left: node.paddingLeft, right: node.paddingRight, top: node.paddingTop, bottom: node.paddingBottom };
      return this.wrappedRow(node, items, ownMain, ownCross, pads, border);
    }

    const knownInnerCross = ownCross === undefined ? undefined : innerOf(ownCross, padCrossStart, padCrossEnd);
    const sizeItem = (item: (typeof items)[number], main: number | undefined, cross: number | undefined) => {
      // A layer stretching across a frame whose cross size isn't known yet (the frame is being
      // measured for its natural size) counts at its own natural size, as in CSS.
      const natural = item.crossMode === 'fill' && cross === undefined ? crossKey : undefined;
      const s = this.size(item.id, { [mainKey]: main, [crossKey]: cross }, natural);
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
      // A hugging frame has no fill children (they are treated as fixed), so it just adds up. A frame
      // measured for its natural size can have them: as in CSS (flex: 1 1 0) they count at their minimum.
      for (const item of fills) sizeItem(item, minSize(this.doc.nodes[item.id], mainKey), stretch(item));
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
    // Layers that stretch across, measured at their natural size above, now take the frame's size.
    if (knownInnerCross === undefined) {
      const inner = innerOf(finalCross, padCrossStart, padCrossEnd);
      for (const item of items) if (item.crossMode === 'fill') sizeItem(item, item.main, inner);
    }

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

  /**
   * A row with wrapping on (CSS `flex-wrap: wrap`). Items are placed on a line
   * until the next one doesn't fit, then a new line starts; lines are as tall
   * as their tallest item and are separated by the gap. Filling layers share
   * the space left on their own line, layers set to fill the height stretch
   * to their line, and the block of lines is aligned like the items
   * (`align-content` follows `align-items`).
   */
  private wrappedRow(
    node: DesignNode,
    items: { id: string; mainMode: string; crossMode: string; main: number; cross: number }[],
    ownWidth: number | undefined,
    ownHeight: number | undefined,
    pad: { left: number; right: number; top: number; bottom: number },
    border: number,
  ): Size {
    const gap = node.gap;
    const innerWidth = ownWidth === undefined ? Infinity : Math.max(0, ownWidth - border - pad.left - pad.right);
    const stretches = (item: (typeof items)[number]) => item.crossMode === 'fill';
    const naturalFor = (item: (typeof items)[number]) => (stretches(item) ? 'height' : undefined);

    // 1. Sizes before lines are formed. A filling layer counts as its minimum (its flex basis).
    for (const item of items) {
      if (item.mainMode === 'fill') {
        item.main = minSize(this.doc.nodes[item.id], 'width');
      } else {
        const s = this.size(item.id, {}, naturalFor(item));
        item.main = s.width;
        item.cross = s.height;
      }
    }

    // 2. Break into lines.
    const lines: (typeof items)[] = [];
    let used = 0;
    for (const item of items) {
      const line = lines[lines.length - 1];
      if (line && used + gap + item.main <= innerWidth + 0.01) {
        line.push(item);
        used += gap + item.main;
      } else {
        lines.push([item]);
        used = item.main;
      }
    }

    // 3. Within each line: share the space left among filling layers, then stretch to the line.
    const lineHeights: number[] = [];
    let widest = 0;
    for (const line of lines) {
      const fills = line.filter((item) => item.mainMode === 'fill');
      const taken = line.reduce((sum, item) => sum + item.main, 0) + gap * (line.length - 1);
      if (fills.length && ownWidth !== undefined) {
        const share = Math.max(0, innerWidth - taken) / fills.length;
        for (const item of fills) {
          const s = this.size(item.id, { width: item.main + share }, naturalFor(item));
          item.main = s.width;
          item.cross = s.height;
        }
      } else {
        for (const item of fills) item.cross = this.size(item.id, { width: item.main }, naturalFor(item)).height;
      }
      const height = Math.max(0, ...line.map((item) => item.cross));
      for (const item of line) {
        if (stretches(item)) item.cross = this.size(item.id, { width: item.main, height }).height;
      }
      lineHeights.push(height);
      widest = Math.max(widest, line.reduce((sum, item) => sum + item.main, 0) + gap * (line.length - 1));
    }

    // 4. The frame's size.
    const linesHeight = lineHeights.reduce((a, b) => a + b, 0) + gap * Math.max(0, lines.length - 1);
    const width = ownWidth ?? widest + pad.left + pad.right + border;
    const height = ownHeight ?? linesHeight + pad.top + pad.bottom + border;

    // 5. Positions: the block of lines, then each item within its line.
    const inner = {
      width: Math.max(0, width - border - pad.left - pad.right),
      height: Math.max(0, height - border - pad.top - pad.bottom),
    };
    const align = (free: number) => (node.align === 'center' ? free / 2 : node.align === 'end' ? free : 0);
    let y = pad.top + align(inner.height - linesHeight);
    lines.forEach((line, i) => {
      const lineHeight = lineHeights[i];
      const free = inner.width - line.reduce((sum, item) => sum + item.main, 0) - gap * (line.length - 1);
      let x = pad.left;
      let spacing = gap;
      if (node.justify === 'center') x += free / 2;
      else if (node.justify === 'end') x += free;
      else if (node.justify === 'space-between' && line.length > 1 && free > 0) spacing += free / (line.length - 1);
      for (const item of line) {
        const at = stretches(item) ? y : y + align(lineHeight - item.cross);
        this.set(item.id, { x, y: at });
        x += item.main + spacing;
      }
      y += lineHeight + gap;
    });

    const size = { width: Math.max(0, width), height: Math.max(0, height) };
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
