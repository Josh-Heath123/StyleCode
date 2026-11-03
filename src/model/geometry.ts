import type { DesignDocument, DesignNode, Point, Rect } from './types';

/**
 * 2D affine matrix [a, b, c, d, e, f], mapping (x, y) to
 * (a·x + c·y + e, b·x + d·y + f) — the same layout as DOMMatrix and canvas.
 */
export type Matrix = readonly [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function translate(tx: number, ty: number): Matrix {
  return [1, 0, 0, 1, tx, ty];
}

export function rotate(degrees: number): Matrix {
  const r = (degrees * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return [cos, sin, -sin, cos, 0, 0];
}

export function invert(m: Matrix): Matrix {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) return IDENTITY;
  const inv = 1 / det;
  return [m[3] * inv, -m[1] * inv, -m[2] * inv, m[0] * inv, (m[2] * m[5] - m[3] * m[4]) * inv, (m[1] * m[4] - m[0] * m[5]) * inv];
}

export function applyToPoint(m: Matrix, p: Point): Point {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

/** Applies only the linear part of the matrix (for direction vectors and deltas). */
export function applyToVector(m: Matrix, v: Point): Point {
  return { x: m[0] * v.x + m[2] * v.y, y: m[1] * v.x + m[3] * v.y };
}

/** The rotation encoded in a matrix, in degrees. */
export function matrixRotation(m: Matrix): number {
  return (Math.atan2(m[1], m[0]) * 180) / Math.PI;
}

/**
 * Offset from a container's border box to its content (padding) box. Child
 * coordinates are relative to the padding box, exactly as in CSS absolute
 * positioning, so the canvas and the generated code can never disagree.
 */
export function contentOffset(node: DesignNode): number {
  if (node.type === 'page') return 0;
  return node.stroke ? node.strokeWidth : 0;
}

/** Transform from a node's own border-box space into its parent's content space. */
export function localMatrix(node: DesignNode): Matrix {
  if (node.type === 'page') return IDENTITY;
  const hw = node.width / 2;
  const hh = node.height / 2;
  let m = translate(node.x + hw, node.y + hh);
  if (node.rotation) m = multiply(m, rotate(node.rotation));
  return multiply(m, translate(-hw, -hh));
}

/** Transform from a container's content space into its own border-box space. */
export function contentMatrix(node: DesignNode): Matrix {
  const o = contentOffset(node);
  return o ? translate(o, o) : IDENTITY;
}

/** Transform from a node's border-box space into world (page) space. */
export function worldMatrix(doc: DesignDocument, id: string): Matrix {
  const node = doc.nodes[id];
  if (!node || !node.parentId) return IDENTITY;
  return multiply(childSpaceMatrix(doc, node.parentId), localMatrix(node));
}

/** Transform from a container's content space (where its children live) into world space. */
export function childSpaceMatrix(doc: DesignDocument, containerId: string): Matrix {
  const node = doc.nodes[containerId];
  if (!node) return IDENTITY;
  return multiply(worldMatrix(doc, containerId), contentMatrix(node));
}

/** World-space corners of a node in the order top-left, top-right, bottom-right, bottom-left. */
export function worldCorners(doc: DesignDocument, id: string): [Point, Point, Point, Point] {
  const node = doc.nodes[id];
  return cornersOf(worldMatrix(doc, id), node.width, node.height);
}

export function cornersOf(m: Matrix, width: number, height: number): [Point, Point, Point, Point] {
  return [
    applyToPoint(m, { x: 0, y: 0 }),
    applyToPoint(m, { x: width, y: 0 }),
    applyToPoint(m, { x: width, y: height }),
    applyToPoint(m, { x: 0, y: height }),
  ];
}

export function boundsOfPoints(points: readonly Point[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Axis-aligned world bounds of a node (of its rotated box, not its children). */
export function worldBounds(doc: DesignDocument, id: string): Rect {
  return boundsOfPoints(worldCorners(doc, id));
}

/** Axis-aligned world bounds of several nodes, or null for an empty list. */
export function unionWorldBounds(doc: DesignDocument, ids: readonly string[]): Rect | null {
  const points: Point[] = [];
  for (const id of ids) if (doc.nodes[id]) points.push(...worldCorners(doc, id));
  return points.length ? boundsOfPoints(points) : null;
}

export function rectContainsPoint(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;
}

export function rectContainsRect(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** Whether a world-space point lies inside a node's (possibly rotated) box. */
export function nodeContainsWorldPoint(doc: DesignDocument, id: string, p: Point): boolean {
  const node = doc.nodes[id];
  const local = applyToPoint(invert(worldMatrix(doc, id)), p);
  return local.x >= 0 && local.y >= 0 && local.x <= node.width && local.y <= node.height;
}

/** Rectangle spanned by two points, regardless of drag direction. */
export function rectFromPoints(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

export function roundTo(value: number, step = 1): number {
  return Math.round(value / step) * step;
}
