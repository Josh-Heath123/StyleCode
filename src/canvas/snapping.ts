import type { Guide } from '../editor/editor';
import { isEffectivelyHidden } from '../model/document';
import { boundsOfPoints, cornersOf, childSpaceMatrix, worldBounds } from '../model/geometry';
import type { DesignDocument, Point, Rect } from '../model/types';

/**
 * Smart guides: snapping a moving box's edges and centre to the edges and
 * centres of nearby layers and of the frame it is in, with guide lines that
 * show what it lined up with. All in world space.
 */

export interface SnapTargets {
  rects: Rect[];
}

/** Screen pixels within which an edge snaps. */
export const SNAP_DISTANCE = 6;

/** Siblings inside `containerId` (minus the moving layers) and the container's own inner box. */
export function snapTargets(doc: DesignDocument, containerId: string, exclude: ReadonlySet<string>): SnapTargets {
  const container = doc.nodes[containerId];
  const rects: Rect[] = [];
  for (const id of container.children) {
    if (exclude.has(id) || isEffectivelyHidden(doc, id)) continue;
    rects.push(worldBounds(doc, id));
  }
  if (container.type !== 'page') {
    const inset = container.stroke ? container.strokeWidth : 0;
    rects.push(
      boundsOfPoints(cornersOf(childSpaceMatrix(doc, containerId), container.width - inset * 2, container.height - inset * 2)),
    );
  }
  return { rects };
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
  const snapped = { ...box, x: box.x + (sx?.delta ?? 0), y: box.y + (sy?.delta ?? 0) };
  const guides: Guide[] = [];
  if (sx) guides.push(guideAt('x', sx.at, snapped, xs));
  if (sy) guides.push(guideAt('y', sy.at, snapped, ys));
  return { dx: sx?.delta ?? 0, dy: sy?.delta ?? 0, guides };
}

/** Snaps a single point (the corner being drawn) to target lines. */
export function snapPoint(p: Point, targets: SnapTargets, threshold: number): { point: Point; guides: Guide[] } {
  const r = snapBox({ x: p.x, y: p.y, width: 0, height: 0 }, targets, threshold, { x: ['start'], y: ['start'] });
  return { point: { x: p.x + r.dx, y: p.y + r.dy }, guides: r.guides };
}
