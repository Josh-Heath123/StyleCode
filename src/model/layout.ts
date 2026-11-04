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
 * - `min-width`, `max-width`, `min-height`, `max-height` on children and
 *   frames, with CSS's rules for sharing space among filling layers
 *   ("freezing" layers that hit a limit and sharing the rest again)
 * - rows with `flex-wrap: wrap` and `align-content` matching `align-items`
 * - grids: `grid-template-columns: repeat(n, minmax(0, 1fr))`, auto rows,
 *   `grid-column: span k`, items stretched or aligned in their cell
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

/** A frame that arranges its children in equal columns. */
export function isGrid(node: DesignNode | undefined): boolean {
  return !!node && node.type === 'frame' && node.layout === 'grid';
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
  if (!isAutoLayout(parent) || node.positioning === 'absolute') return false;
  // A grid cell always has a size to fill: its column's width, and its row's height.
  return isGrid(parent) || !hugs(parent, axis);
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
 * The range auto layout may give a layer along an axis: at least its border
 * and padding and its own minimum, at most its maximum (0 means none). As in
 * CSS, the minimum wins when the two conflict.
 */
export function sizeLimits(node: DesignNode, axis: Axis): { min: number; max: number } {
  const min = Math.max(minSize(node, axis), axis === 'width' ? node.minWidth : node.minHeight);
  const limit = axis === 'width' ? node.maxWidth : node.maxHeight;
  return { min, max: limit > 0 ? Math.max(min, limit) : Infinity };
}

const clamp = (value: number, { min, max }: { min: number; max: number }) => Math.min(max, Math.max(min, value));

/**
 * Sizes for layers that share space along a line (CSS "resolving flexible
 * lengths" for `flex: 1 1 0`). Each starts from its base (its border and
 * padding) and gets an equal share of what is left; a layer pushed past one
 * of its limits is held at it ("frozen") and the rest is shared again.
 */
export function flexSizes(items: readonly { base: number; min: number; max: number }[], available: number): number[] {
  const hypothetical = items.map((item) => clamp(item.base, item));
  const sizes = [...hypothetical];
  // With a zero flex basis there is nothing to shrink: when even the hypothetical sizes don't fit, they overflow.
  if (hypothetical.reduce((a, b) => a + b, 0) >= available) return sizes;
  const frozen = items.map((item, i) => item.base > hypothetical[i]);
  for (let round = 0; round <= items.length; round++) {
    const open = items.map((_, i) => i).filter((i) => !frozen[i]);
    if (open.length === 0) break;
    const taken = items.reduce((sum, item, i) => sum + (frozen[i] ? sizes[i] : item.base), 0);
    const share = (available - taken) / open.length;
    let violation = 0;
    const clamped = new Map<number, number>();
    for (const i of open) {
      const target = items[i].base + share;
      const value = clamp(target, items[i]);
      violation += value - target;
      clamped.set(i, value - target);
      sizes[i] = value;
    }
    if (Math.abs(violation) < 1e-9) break;
    for (const [i, delta] of clamped) if ((violation > 0 && delta > 0) || (violation < 0 && delta < 0)) frozen[i] = true;
  }
  return sizes;
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
    const widthLimits = sizeLimits(node, 'width');
    let width: number;
    let height: number;
    if (node.type === 'text') {
      const fixedHeight = node.textResize === 'fixed' && natural !== 'height';
      if (assigned.width !== undefined) {
        width = clamp(assigned.width, widthLimits);
        height = assigned.height ?? (fixedHeight ? current.height : this.measure(node, width).height);
      } else if (node.textResize === 'auto-width') {
        // Text on one line never wraps (white-space: pre), even when a maximum narrows its box.
        const size = this.measure(node);
        width = clamp(size.width, widthLimits);
        height = assigned.height ?? size.height;
      } else if (natural === 'width') {
        // Asked for its natural width (it is about to fill a grid cell whose width depends on its
        // content): as wide as its longest line, like CSS's max-content.
        width = clamp(this.measure({ ...node, textResize: 'auto-width' }).width, widthLimits);
        height = assigned.height ?? this.measure(node, width).height;
      } else {
        width = clamp(current.width, widthLimits);
        height = assigned.height ?? (fixedHeight ? current.height : this.measure(node, width).height);
      }
    } else {
      // A shape has no content, so its natural size is just its border.
      width = clamp(assigned.width ?? (natural === 'width' ? 0 : current.width), widthLimits);
      height = assigned.height ?? (natural === 'height' ? 0 : current.height);
    }
    height = clamp(height, sizeLimits(node, 'height'));
    this.set(id, { width, height });
    return { width, height };
  }

  private frame(node: DesignNode, assigned: Partial<Size>, natural?: Axis): Size {
    if (isGrid(node)) return this.grid(node, assigned, natural);
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
      return size === undefined ? undefined : clamp(size, sizeLimits(node, axis));
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
      return this.wrappedRow(node, items, ownMain, ownCross, pads, border, natural === 'width');
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
    const flexItem = (item: (typeof items)[number]) => {
      const n = this.doc.nodes[item.id];
      return { base: minSize(n, mainKey), ...sizeLimits(n, mainKey) };
    };
    if (ownMain === undefined) {
      // A hugging frame has no fill children (they are treated as fixed), so it just adds up. A frame
      // measured for its natural size can have them: as in CSS (flex: 1 1 0) they count at their minimum.
      for (const item of fills) sizeItem(item, clamp(minSize(this.doc.nodes[item.id], mainKey), flexItem(item)), stretch(item));
      const content = items.reduce((sum, item) => sum + item.main, 0) + gaps + padMainStart + padMainEnd + border;
      finalMain = clamp(content, sizeLimits(node, mainKey));
    } else {
      finalMain = ownMain;
      // As in CSS (flex: 1 1 0), a filling layer never shrinks below its own padding and border,
      // and stays within its minimum and maximum; the space left is shared equally.
      const used = items.filter((item) => item.mainMode !== 'fill').reduce((sum, item) => sum + item.main, 0);
      const available = innerOf(ownMain, padMainStart, padMainEnd) - used - gaps;
      const sizes = flexSizes(fills.map(flexItem), available);
      fills.forEach((item, i) => sizeItem(item, sizes[i], stretch(item)));
    }

    // 3. Cross size: hugging frames fit their tallest (or widest) child.
    const finalCross =
      ownCross ??
      clamp(Math.max(0, ...items.map((item) => item.cross)) + padCrossStart + padCrossEnd + border, sizeLimits(node, crossKey));
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
   * A grid (CSS `display: grid` with `grid-template-columns: repeat(n,
   * minmax(0, 1fr))` and rows as tall as their content). Layers are placed
   * left to right, row by row, each spanning `columnSpan` columns; one that
   * doesn't fit in what is left of a row starts the next. Columns share the
   * width equally (when the grid hugs its width, they are as wide as the
   * widest content needs). Layers set to fill take their cell's width or
   * their row's height; the others are aligned in their cell by the frame's
   * justify and align.
   */
  private grid(node: DesignNode, assigned: Partial<Size>, natural?: Axis): Size {
    const border = contentOffset(node) * 2;
    const current = this.box(node.id);
    const gap = node.gap;
    const columns = Math.max(1, Math.round(node.columns));
    const padX = node.paddingLeft + node.paddingRight;
    const padY = node.paddingTop + node.paddingBottom;
    const own = (axis: Axis): number | undefined => {
      const mode = axis === 'width' ? node.widthMode : node.heightMode;
      const size = assigned[axis] ?? (mode === 'hug' || axis === natural ? undefined : current[axis]);
      return size === undefined ? undefined : clamp(size, sizeLimits(node, axis));
    };
    const ownWidth = own('width');
    const ownHeight = own('height');

    const visible = node.children.map((id) => this.doc.nodes[id]).filter((child) => child.visible);
    for (const child of visible) if (child.positioning === 'absolute') this.size(child.id, {});
    const items = visible
      .filter((child) => child.positioning !== 'absolute')
      .map((child) => ({
        id: child.id,
        span: Math.min(columns, Math.max(1, Math.round(child.columnSpan))),
        fillWidth: effectiveSizing(child, 'width', node) === 'fill',
        fillHeight: effectiveSizing(child, 'height', node) === 'fill',
        row: 0,
        col: 0,
        cell: 0,
        width: 0,
        height: 0,
      }));

    // 1. Placement: left to right, starting a new row when a layer doesn't fit in what is left.
    let row = 0;
    let col = 0;
    for (const item of items) {
      if (col > 0 && col + item.span > columns) {
        row++;
        col = 0;
      }
      item.row = row;
      item.col = col;
      col += item.span;
    }
    const rowCount = items.length ? row + 1 : 0;

    // 2. Column width.
    let width: number;
    let colWidth: number;
    const columnsFor = (outer: number) => Math.max(0, (outer - border - padX - gap * (columns - 1)) / columns);
    if (ownWidth !== undefined) {
      width = ownWidth;
      colWidth = columnsFor(width);
    } else {
      let need = 0;
      for (const item of items) {
        const content = this.size(item.id, {}, item.fillWidth ? 'width' : undefined).width;
        need = Math.max(need, (content - gap * (item.span - 1)) / item.span);
      }
      const content = need * columns + gap * (columns - 1) + padX + border;
      width = clamp(content, sizeLimits(node, 'width'));
      colWidth = width === content ? need : columnsFor(width);
    }

    // 3. Each layer in its cell; rows as tall as their tallest layer.
    const rowHeights = new Array<number>(rowCount).fill(0);
    for (const item of items) {
      item.cell = colWidth * item.span + gap * (item.span - 1);
      const s = this.size(item.id, { width: item.fillWidth ? item.cell : undefined }, item.fillHeight ? 'height' : undefined);
      item.width = s.width;
      item.height = s.height;
      rowHeights[item.row] = Math.max(rowHeights[item.row], s.height);
    }
    for (const item of items) {
      if (!item.fillHeight) continue;
      const s = this.size(item.id, { width: item.width, height: rowHeights[item.row] });
      item.width = s.width;
      item.height = s.height;
    }

    // 4. The grid's height, then positions (relative to the padding box).
    const content = rowHeights.reduce((a, b) => a + b, 0) + gap * Math.max(0, rowCount - 1) + padY + border;
    const height = ownHeight ?? clamp(content, sizeLimits(node, 'height'));
    const rowTops: number[] = [];
    let y = node.paddingTop;
    for (const h of rowHeights) {
      rowTops.push(y);
      y += h + gap;
    }
    const offset = (free: number, how: string) => (how === 'center' ? free / 2 : how === 'end' ? free : 0);
    for (const item of items) {
      let x = node.paddingLeft + item.col * (colWidth + gap);
      if (!item.fillWidth) x += offset(item.cell - item.width, node.justify);
      let top = rowTops[item.row];
      if (!item.fillHeight) top += offset(rowHeights[item.row] - item.height, node.align);
      this.set(item.id, { x, y: top });
    }

    const size = { width: Math.max(0, width), height: Math.max(0, height) };
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
    measuringNaturalWidth = false,
  ): Size {
    const gap = node.gap;
    const stretches = (item: (typeof items)[number]) => item.crossMode === 'fill';
    const naturalFor = (item: (typeof items)[number]) => (stretches(item) ? 'height' : undefined);
    const limitsOf = (item: (typeof items)[number]) => sizeLimits(this.doc.nodes[item.id], 'width');

    // 1. Sizes before lines are formed. A filling layer counts as its minimum (its flex basis),
    //    within its own limits: a minimum width is what makes it move onto a new line.
    for (const item of items) {
      if (item.mainMode === 'fill') {
        item.main = clamp(minSize(this.doc.nodes[item.id], 'width'), limitsOf(item));
      } else {
        const s = this.size(item.id, {}, naturalFor(item));
        item.main = s.width;
        item.cross = s.height;
      }
    }

    // A row that hugs its width is as wide as everything on one line, within its own limits;
    // when a maximum (or a minimum) decides its width, the lines break at that width, as in CSS.
    if (ownWidth === undefined && !measuringNaturalWidth) {
      const oneLine = items.reduce((sum, item) => sum + item.main, 0) + gap * Math.max(0, items.length - 1);
      const natural = oneLine + pad.left + pad.right + border;
      const limited = clamp(natural, sizeLimits(node, 'width'));
      if (limited !== natural) ownWidth = limited;
    }
    const innerWidth = ownWidth === undefined ? Infinity : Math.max(0, ownWidth - border - pad.left - pad.right);

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
      if (fills.length && ownWidth !== undefined) {
        const fixed = line.filter((item) => item.mainMode !== 'fill').reduce((sum, item) => sum + item.main, 0);
        const available = innerWidth - fixed - gap * (line.length - 1);
        const sizes = flexSizes(
          fills.map((item) => ({ base: minSize(this.doc.nodes[item.id], 'width'), ...limitsOf(item) })),
          available,
        );
        fills.forEach((item, i) => {
          const s = this.size(item.id, { width: sizes[i] }, naturalFor(item));
          item.main = s.width;
          item.cross = s.height;
        });
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
    const width = ownWidth ?? clamp(widest + pad.left + pad.right + border, sizeLimits(node, 'width'));
    const height = ownHeight ?? clamp(linesHeight + pad.top + pad.bottom + border, sizeLimits(node, 'height'));

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
