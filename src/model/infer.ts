import type { Align, LayoutDirection, Rect } from './types';

/**
 * Layout inference: turning a rough sketch into rows and columns.
 *
 * Given the boxes of some layers, `arrange` finds a nested row/column
 * structure with recursive XY-cut, a classic page-layout analysis technique:
 * look for a clean horizontal or vertical gap that splits the boxes into
 * groups, recurse into each group, and stop when a group is a single box or
 * cannot be split (its boxes overlap).
 *
 * Within each row or column it measures gaps and alignment, and spots
 * clusters separated by unusually large gaps (a nav bar's logo, links and
 * button), which become their own sub-groups. Everything is deterministic: the
 * same sketch always produces the same structure, with no AI involved.
 */

export interface LayoutItem {
  id: string;
  box: Rect;
}

export type Arrangement =
  | { kind: 'leaf'; id: string; box: Rect }
  | {
      kind: 'stack';
      direction: Exclude<LayoutDirection, 'none'>;
      items: Arrangement[];
      gap: number;
      align: Align;
      /** True when the stack's items are clusters separated by large gaps (spread them apart). */
      spread: boolean;
      /** Typical gap between items: the gap to use when the stack cannot spread (it hugs its content). */
      typicalGap: number;
      box: Rect;
    }
  | { kind: 'freeform'; items: LayoutItem[]; box: Rect };

/** Overlap allowed between neighbours that still counts as "next to each other". */
const TOLERANCE = 2;

export function unionRect(rects: readonly Rect[]): Rect {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { x, y, width: right - x, height: bottom - y };
}

/** Splits boxes into groups separated by gaps along one axis, or null if no gap exists. */
function cut(items: readonly LayoutItem[], axis: 'x' | 'y'): LayoutItem[][] | null {
  const size = axis === 'x' ? 'width' : 'height';
  const sorted = [...items].sort((a, b) => a.box[axis] - b.box[axis]);
  const groups: LayoutItem[][] = [];
  let end = -Infinity;
  for (const item of sorted) {
    const start = item.box[axis];
    if (groups.length === 0 || start >= end - TOLERANCE) groups.push([item]);
    else groups[groups.length - 1].push(item);
    end = Math.max(end, start + item.box[size]);
  }
  return groups.length > 1 ? groups : null;
}

/** The narrowest gap between consecutive groups produced by a cut. */
function smallestGap(groups: readonly LayoutItem[][], axis: 'x' | 'y'): number {
  const size = axis === 'x' ? 'width' : 'height';
  let smallest = Infinity;
  for (let i = 1; i < groups.length; i++) {
    const prevEnd = Math.max(...groups[i - 1].map((it) => it.box[axis] + it.box[size]));
    const nextStart = Math.min(...groups[i].map((it) => it.box[axis]));
    smallest = Math.min(smallest, nextStart - prevEnd);
  }
  return smallest;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** The cross-axis alignment that best explains where the items sit. */
export function inferAlign(boxes: readonly Rect[], direction: 'row' | 'column', within: Rect): Align {
  const start = direction === 'row' ? 'y' : 'x';
  const size = direction === 'row' ? 'height' : 'width';
  const lo = within[start];
  const hi = within[start] + within[size];
  const deviation = (f: (r: Rect) => number) => Math.max(...boxes.map(f));
  const startDev = deviation((r) => Math.abs(r[start] - lo));
  const endDev = deviation((r) => Math.abs(hi - (r[start] + r[size])));
  const centerDev = deviation((r) => Math.abs(r[start] + r[size] / 2 - (lo + hi) / 2));
  const best = Math.min(startDev, endDev, centerDev);
  if (startDev <= best + TOLERANCE) return 'start';
  if (centerDev <= best + TOLERANCE) return 'center';
  return 'end';
}

function gapsBetween(boxes: readonly Rect[], direction: 'row' | 'column'): number[] {
  const start = direction === 'row' ? 'x' : 'y';
  const size = direction === 'row' ? 'width' : 'height';
  const gaps: number[] = [];
  for (let i = 1; i < boxes.length; i++) gaps.push(Math.max(0, boxes[i][start] - (boxes[i - 1][start] + boxes[i - 1][size])));
  return gaps;
}

function stack(direction: 'row' | 'column', items: Arrangement[], spread = false): Arrangement {
  const boxes = items.map((it) => it.box);
  const box = unionRect(boxes);
  const gaps = gapsBetween(boxes, direction);
  return {
    kind: 'stack',
    direction,
    items,
    // A spread-out stack's gap is only the minimum spacing when space runs short; keep it modest.
    gap: Math.round(spread ? Math.min(32, ...gaps) : median(gaps)),
    align: inferAlign(boxes, direction, box),
    spread,
    typicalGap: Math.round(median(gaps)),
    box,
  };
}

/**
 * Groups items separated by clearly larger gaps: with gaps of 40, 40 and 300
 * the first three items belong together and the last stands apart.
 */
function cluster(items: Arrangement[], direction: 'row' | 'column'): Arrangement {
  const gaps = gapsBetween(
    items.map((it) => it.box),
    direction,
  );
  if (items.length >= 3) {
    const smallest = Math.min(...gaps);
    const threshold = Math.max(smallest * 2, smallest + 24);
    const isBig = gaps.map((g) => g > threshold);
    if (isBig.some(Boolean) && !isBig.every(Boolean)) {
      const clusters: Arrangement[][] = [[items[0]]];
      gaps.forEach((_, i) => {
        if (isBig[i]) clusters.push([]);
        clusters[clusters.length - 1].push(items[i + 1]);
      });
      const grouped = clusters.map((c) => (c.length === 1 ? c[0] : stack(direction, c)));
      return stack(direction, grouped, true);
    }
  }
  return stack(direction, items);
}

/** Finds a row/column structure for the given boxes. */
export function arrange(items: readonly LayoutItem[]): Arrangement {
  if (items.length === 1) return { kind: 'leaf', id: items[0].id, box: items[0].box };
  const box = unionRect(items.map((it) => it.box));
  const byY = cut(items, 'y');
  const byX = cut(items, 'x');
  if (!byY && !byX) return { kind: 'freeform', items: [...items], box };

  // Like classic XY-cut, split at the widest whitespace first: three cards side by side,
  // each a stack of icon, title and text, are separated by wider gaps between cards
  // than within them, so they become three columns. Ties go to a column (reading order).
  let direction: 'row' | 'column';
  if (byY && byX) direction = smallestGap(byX, 'x') > smallestGap(byY, 'y') + TOLERANCE ? 'row' : 'column';
  else direction = byY ? 'column' : 'row';
  const groups = (direction === 'column' ? byY : byX)!;
  return cluster(
    groups.map((g) => arrange(g)),
    direction,
  );
}
