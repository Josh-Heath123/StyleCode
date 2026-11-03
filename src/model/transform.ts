import { applyToVector, rotate } from './geometry';
import type { Point, Rect } from './types';
import { wrapDegrees } from './properties';

/** A box in some parent space: position of the unrotated top-left, size and rotation around its centre. */
export interface Box extends Rect {
  rotation: number;
}

/** Resize handle direction: -1 = left/top edge, 1 = right/bottom edge, 0 = that axis is not affected. */
export interface Handle {
  hx: -1 | 0 | 1;
  hy: -1 | 0 | 1;
}

export interface ResizeOptions {
  /** Keep the original aspect ratio (Shift). */
  keepAspect?: boolean;
  /** Resize symmetrically around the centre (Alt). */
  fromCenter?: boolean;
  minSize?: number;
}

type Range = [number, number];

function axisRange(h: -1 | 0 | 1, pointer: number, length: number, fromCenter: boolean): Range {
  if (h === 0) return [0, length];
  if (fromCenter) {
    const d = Math.abs(pointer - length / 2);
    return [length / 2 - d, length / 2 + d];
  }
  return h === 1 ? [0, pointer] : [pointer, length];
}

function scaledRange(h: -1 | 0 | 1, range: Range, length: number, scale: number, fromCenter: boolean): Range {
  const size = length * scale;
  if (h === 0 || fromCenter) return [length / 2 - size / 2, length / 2 + size / 2];
  if (h === 1) return [0, range[1] >= 0 ? size : -size];
  return [range[0] <= length ? length - size : length + size, length];
}

function normalizeRange(h: -1 | 0 | 1, [a, b]: Range, minSize: number): Range {
  let lo = Math.min(a, b);
  let hi = Math.max(a, b);
  if (hi - lo < minSize) {
    if (h === -1) lo = hi - minSize;
    else hi = lo + minSize;
  }
  return [lo, hi];
}

/**
 * Resizes a (possibly rotated) box by dragging one of its handles to `pointer`.
 * The opposite edge or corner stays fixed in parent space; with `fromCenter`
 * the centre stays fixed instead. Rotation is preserved.
 */
export function resizeBox(box: Box, handle: Handle, pointer: Point, options: ResizeOptions = {}): Rect {
  const { keepAspect = false, fromCenter = false, minSize = 1 } = options;
  const { width: w, height: h, rotation } = box;
  const center = { x: box.x + w / 2, y: box.y + h / 2 };

  // Pointer in the box's own unrotated space, origin at its top-left.
  const rel = applyToVector(rotate(-rotation), { x: pointer.x - center.x, y: pointer.y - center.y });
  const local = { x: rel.x + w / 2, y: rel.y + h / 2 };

  let xr = axisRange(handle.hx, local.x, w, fromCenter);
  let yr = axisRange(handle.hy, local.y, h, fromCenter);

  if (keepAspect && w > 0 && h > 0) {
    const sx = Math.abs(xr[1] - xr[0]) / w;
    const sy = Math.abs(yr[1] - yr[0]) / h;
    const scale = handle.hx && handle.hy ? Math.max(sx, sy) : handle.hx ? sx : sy;
    xr = scaledRange(handle.hx, xr, w, scale, fromCenter);
    yr = scaledRange(handle.hy, yr, h, scale, fromCenter);
  }

  const [x0, x1] = normalizeRange(handle.hx, xr, minSize);
  const [y0, y1] = normalizeRange(handle.hy, yr, minSize);
  const width = x1 - x0;
  const height = y1 - y0;

  // Move the new centre back into parent space.
  const offset = applyToVector(rotate(rotation), { x: x0 + width / 2 - w / 2, y: y0 + height / 2 - h / 2 });
  const newCenter = { x: center.x + offset.x, y: center.y + offset.y };
  return { x: newCenter.x - width / 2, y: newCenter.y - height / 2, width, height };
}

/**
 * Scale factors to apply to a rotated box's own width and height when its
 * world bounds are scaled by (sx, sy). Exact for multiples of 90°, a close
 * approximation otherwise.
 */
export function localScaleForRotation(rotationDeg: number, sx: number, sy: number): { sw: number; sh: number } {
  const r = (rotationDeg * Math.PI) / 180;
  const c = Math.abs(Math.cos(r));
  const s = Math.abs(Math.sin(r));
  return { sw: Math.hypot(c * sx, s * sy), sh: Math.hypot(s * sx, c * sy) };
}

/** Angle in degrees of `p` around `center`, measured clockwise from the +x axis (screen convention). */
export function angleAround(center: Point, p: Point): number {
  return (Math.atan2(p.y - center.y, p.x - center.x) * 180) / Math.PI;
}

/** New rotation after dragging from `start` to `current` around `center`. */
export function rotateByDrag(original: number, center: Point, start: Point, current: Point, snapDegrees = 0): number {
  let next = original + angleAround(center, current) - angleAround(center, start);
  if (snapDegrees > 0) next = Math.round(next / snapDegrees) * snapDegrees;
  return wrapDegrees(next);
}

/**
 * Changes a box's size while keeping one of its points fixed in parent space.
 * `ax`/`ay` give that point as fractions of the size (0 = left/top, 1 = right/bottom).
 * Works for rotated boxes; used to grow auto-sizing text from its alignment edge.
 */
export function resizeAroundAnchor(box: Box, width: number, height: number, ax: number, ay: number): Rect {
  const r = rotate(box.rotation);
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const before = applyToVector(r, { x: (ax - 0.5) * box.width, y: (ay - 0.5) * box.height });
  const anchor = { x: center.x + before.x, y: center.y + before.y };
  const after = applyToVector(r, { x: (ax - 0.5) * width, y: (ay - 0.5) * height });
  const newCenter = { x: anchor.x - after.x, y: anchor.y - after.y };
  return { x: newCenter.x - width / 2, y: newCenter.y - height / 2, width, height };
}
