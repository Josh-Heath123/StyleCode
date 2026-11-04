import type { Guide } from '../editor/editor';
import { isEffectivelyHidden } from '../model/document';
import { boundsOfPoints, cornersOf, childSpaceMatrix, worldBounds } from '../model/geometry';
import type { DesignDocument, Point, Rect } from '../model/types';

/**
 * Smart guides: snapping a moving box's edges and centre to the edges and
 * centres of nearby layers and of the frame it is in, with guide lines that
 * show what it lined up with, and to equal spacing: the same gap as other
 * layers in the row, or the middle between two neighbours. All in world space.
 */

export interface SnapTargets {
  /** Siblings and the container's inner box: edges and centres to line up with. */
  rects: Rect[];
  /** Siblings only: neighbours to space evenly against. */
  siblings: Rect[];
}

/** Screen pixels within which an edge snaps. */
export const SNAP_DISTANCE = 6;

/** Siblings inside `containerId` (minus the moving layers) and the container's own inner box. */
export function snapTargets(doc: DesignDocument, containerId: string, exclude: ReadonlySet<string>): SnapTargets {
  const container = doc.nodes[containerId];
  const rects: Rect[] = [];
  for (const id of container.children) {
    if (exclude.has(id) || isEffectivelyHidden(doc, id) || doc.nodes[id].type === 'note') continue;
    rects.push(worldBounds(doc, id));
  }
  const siblings = [...rects];
  if (container.type !== 'page') {
    const inset = container.stroke ? container.strokeWidth : 0;
    rects.push(
      boundsOfPoints(cornersOf(childSpaceMatrix(doc, containerId), container.width - inset * 2, container.height - inset * 2)),
    );
  }
  return { rects, siblings };
}

type Axis = { pos: 'x' | 'y'; size: 'width' | 'height'; cross: 'x' | 'y'; crossSize: 'width' | 'height' };
const X: Axis = { pos: 'x', size: 'width', cross: 'y', crossSize: 'height' };
const Y: Axis = { pos: 'y', size: 'height', cross: 'x', crossSize: 'width' };

const end = (r: Rect, a: Axis) => r[a.pos] + r[a.size];
const overlapsAcross = (r: Rect, box: Rect, a: Axis) =>
  r[a.cross] < box[a.cross] + box[a.crossSize] && box[a.cross] < r[a.cross] + r[a.crossSize];

/**
 * Equal spacing along one axis: among the siblings level with the box, the
 * smallest move that gives it the same gap as two neighbours already have,
 * or puts it in the middle between two neighbours. Returns the move and
 * guides marking every gap of that size in the row.
 */
function spacingSnap(
  box: Rect,
  siblings: readonly Rect[],
  a: Axis,
  threshold: number,
): { delta: number; guides: Guide[] } | null {
  const row = siblings.filter((r) => overlapsAcross(r, box, a)).sort((p, q) => p[a.pos] - q[a.pos]);
  if (row.length === 0) return null;
  const gaps: number[] = [];
  for (let i = 0; i + 1 < row.length; i++) {
    const g = row[i + 1][a.pos] - end(row[i], a);
    if (g > 0.5) gaps.push(g);
  }
  const centre = box[a.pos] + box[a.size] / 2;
  const before = row.filter((r) => r[a.pos] + r[a.size] / 2 < centre);
  const after = row.filter((r) => r[a.pos] + r[a.size] / 2 >= centre);
  const candidates: number[] = [];
  const left = before.reduce<Rect | null>((best, r) => (!best || end(r, a) > end(best, a) ? r : best), null);
  const right = after.reduce<Rect | null>((best, r) => (!best || r[a.pos] < best[a.pos] ? r : best), null);
  for (const g of gaps) {
    if (left) candidates.push(end(left, a) + g - box[a.pos]);
    if (right) candidates.push(right[a.pos] - g - box[a.size] - box[a.pos]);
  }
  if (left && right) {
    const g = (right[a.pos] - end(left, a) - box[a.size]) / 2;
    if (g > 0.5) candidates.push(end(left, a) + g - box[a.pos]);
  }
  let delta: number | null = null;
  for (const c of candidates) if (Math.abs(c) <= threshold && (delta === null || Math.abs(c) < Math.abs(delta))) delta = c;
  if (delta === null) return null;

  // Mark every gap in the row (box included) that matches the one the box now has.
  const moved = { ...box, [a.pos]: box[a.pos] + delta };
  const all = [...row, moved].sort((p, q) => p[a.pos] - q[a.pos]);
  const at = all.indexOf(moved);
  const own = [at > 0 ? moved[a.pos] - end(all[at - 1], a) : NaN, at + 1 < all.length ? all[at + 1][a.pos] - end(moved, a) : NaN];
  const size = own.find((g) => Number.isFinite(g) && g > 0.5 && gaps.concat(own).some((o) => o !== g && Math.abs(o - g) < 0.5));
  const target = size ?? own.find((g) => Number.isFinite(g) && g > 0.5);
  if (target === undefined) return { delta, guides: [] };
  const guides: Guide[] = [];
  for (let i = 0; i + 1 < all.length; i++) {
    const p = all[i];
    const q = all[i + 1];
    const g = q[a.pos] - end(p, a);
    if (Math.abs(g - target) >= 0.5) continue;
    // Across the middle of where the two overlap (or of the pair, if they don't).
    const lo = Math.max(p[a.cross], q[a.cross]);
    const hi = Math.min(p[a.cross] + p[a.crossSize], q[a.cross] + q[a.crossSize]);
    const mid = hi > lo ? (lo + hi) / 2 : (p[a.cross] + q[a.cross] + q[a.crossSize]) / 2;
    const label = String(Math.round(g * 10) / 10);
    guides.push(
      a.pos === 'x'
        ? { x1: end(p, a), y1: mid, x2: q[a.pos], y2: mid, kind: 'gap', label }
        : { x1: mid, y1: end(p, a), x2: mid, y2: q[a.pos], kind: 'gap', label },
    );
  }
  return { delta, guides };
}

type AxisLine = { value: number; rect: Rect };

function lines(rects: readonly Rect[], axis: 'x' | 'y'): AxisLine[] {
  const size = axis === 'x' ? 'width' : 'height';
  return rects.flatMap((rect) => [
    { value: rect[axis], rect },
    { value: rect[axis] + rect[size] / 2, rect },
    { value: rect[axis] + rect[size], rect },
  ]);
}

/**
 * Finds the smallest correction (within `threshold`) that lines one of
 * `values` up with a target line on that axis.
 */
function bestSnap(
  values: readonly number[],
  targets: readonly AxisLine[],
  threshold: number,
): { delta: number; at: number } | null {
  let best: { delta: number; at: number } | null = null;
  for (const v of values) {
    for (const t of targets) {
      const d = t.value - v;
      if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.delta))) best = { delta: d, at: t.value };
    }
  }
  return best;
}

function guideAt(axis: 'x' | 'y', at: number, box: Rect, targets: readonly AxisLine[]): Guide {
  const matched = targets.filter((t) => Math.abs(t.value - at) < 0.5).map((t) => t.rect);
  const all = [box, ...matched];
  if (axis === 'x') {
    const y1 = Math.min(...all.map((r) => r.y));
    const y2 = Math.max(...all.map((r) => r.y + r.height));
    return { x1: at, y1, x2: at, y2, kind: 'snap' };
  }
  const x1 = Math.min(...all.map((r) => r.x));
  const x2 = Math.max(...all.map((r) => r.x + r.width));
  return { x1, y1: at, x2, y2: at, kind: 'snap' };
}

/**
 * Snaps a moving box. `edges` chooses which parts of the box may snap on each
 * axis: all three (move) or just the edge being dragged (resize).
 */
export function snapBox(
  box: Rect,
  targets: SnapTargets,
  threshold: number,
  edges: { x: ('start' | 'center' | 'end')[]; y: ('start' | 'center' | 'end')[] } = {
    x: ['start', 'center', 'end'],
    y: ['start', 'center', 'end'],
  },
): { dx: number; dy: number; guides: Guide[] } {
  const xs = lines(targets.rects, 'x');
  const ys = lines(targets.rects, 'y');
  const pick = (start: number, size: number, which: ('start' | 'center' | 'end')[]) =>
    which.map((w) => (w === 'start' ? start : w === 'center' ? start + size / 2 : start + size));
  const sx = bestSnap(pick(box.x, box.width, edges.x), xs, threshold);
  const sy = bestSnap(pick(box.y, box.height, edges.y), ys, threshold);
  // When the whole box moves, equal spacing competes with lining up edges: the nearer one wins.
  const moving = edges.x.length === 3 && edges.y.length === 3;
  const gx = moving ? spacingSnap(box, targets.siblings, X, threshold) : null;
  const gy = moving ? spacingSnap(box, targets.siblings, Y, threshold) : null;
  const useGx = !!gx && (!sx || Math.abs(gx.delta) < Math.abs(sx.delta) - 0.01);
  const useGy = !!gy && (!sy || Math.abs(gy.delta) < Math.abs(sy.delta) - 0.01);
  const dx = useGx ? gx!.delta : (sx?.delta ?? 0);
  const dy = useGy ? gy!.delta : (sy?.delta ?? 0);
  const snapped = { ...box, x: box.x + dx, y: box.y + dy };
  const guides: Guide[] = [];
  if (useGx) guides.push(...(spacingSnap(snapped, targets.siblings, X, 0.05)?.guides ?? []));
  else if (sx) guides.push(guideAt('x', sx.at, snapped, xs));
  if (useGy) guides.push(...(spacingSnap(snapped, targets.siblings, Y, 0.05)?.guides ?? []));
  else if (sy) guides.push(guideAt('y', sy.at, snapped, ys));
  return { dx, dy, guides };
}

/** Snaps a single point (the corner being drawn) to target lines. */
export function snapPoint(p: Point, targets: SnapTargets, threshold: number): { point: Point; guides: Guide[] } {
  const r = snapBox({ x: p.x, y: p.y, width: 0, height: 0 }, targets, threshold, { x: ['start'], y: ['start'] });
  return { point: { x: p.x + r.dx, y: p.y + r.dy }, guides: r.guides };
}
