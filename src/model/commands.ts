import { createNode } from './defaults';
import { collectSubtree, getAncestors, indexInParent, isContainer, sortByDocumentOrder, topLevelIds } from './document';
import {
  applyToPoint,
  applyToVector,
  boundsOfPoints,
  childSpaceMatrix,
  cornersOf,
  invert,
  matrixRotation,
  unionWorldBounds,
  worldBounds,
  worldMatrix,
} from './geometry';
import { createId } from './ids';
import { OpBuilder, type Op } from './ops';
import { wrapDegrees } from './properties';
import type { DesignDocument, DesignNode, NodeProps, NodeType, Point, Rect } from './types';

/**
 * Commands turn editing intentions into operations. They are pure functions
 * of the document, which keeps them easy to test and lets the AI layer reuse
 * them later.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

export function createNodeOps(
  doc: DesignDocument,
  type: NodeType,
  parentId: string,
  rect: Rect,
  props: Partial<NodeProps> = {},
  index = -1,
): { ops: Op[]; id: string } {
  const parent = doc.nodes[parentId];
  const id = createId();
  const node = createNode(type, { ...rect, ...props }, id);
  return { ops: [{ type: 'create', parentId, index: index < 0 ? parent.children.length : index, nodes: [node] }], id };
}

export function deleteOps(doc: DesignDocument, ids: readonly string[]): Op[] {
  return topLevelIds(doc, ids)
    .filter((id) => id !== doc.rootId)
    .map((id) => ({ type: 'delete', id }));
}

/** World position of a node expressed in a container's content space: centre and rotation. */
function placementIn(doc: DesignDocument, id: string, containerId: string): { x: number; y: number; rotation: number } {
  const node = doc.nodes[id];
  const world = worldMatrix(doc, id);
  const toContainer = invert(childSpaceMatrix(doc, containerId));
  const centerWorld = applyToPoint(world, { x: node.width / 2, y: node.height / 2 });
  const center = applyToPoint(toContainer, centerWorld);
  const rotation = wrapDegrees(matrixRotation(world) - matrixRotation(childSpaceMatrix(doc, containerId)));
  return { x: round2(center.x - node.width / 2), y: round2(center.y - node.height / 2), rotation: round2(rotation) };
}

/** Moves a node into another container without changing where it appears on the page. */
export function reparentKeepingPosition(builder: OpBuilder, id: string, parentId: string, index: number): void {
  const placement = placementIn(builder.doc, id, parentId);
  builder.push({ type: 'move', id, parentId, index });
  builder.push({ type: 'update', id, props: placement });
}

/** Wraps layers that share a parent in a new transparent, non-clipping frame. */
export function groupOps(doc: DesignDocument, ids: readonly string[]): { ops: Op[]; groupId: string } | null {
  const top = sortByDocumentOrder(doc, topLevelIds(doc, ids)).filter((id) => id !== doc.rootId);
  if (top.length === 0) return null;

  // Group into the parent of the top-most layer; others are re-parented in place.
  const parentId = doc.nodes[top[top.length - 1]].parentId!;
  const parentSpace = invert(childSpaceMatrix(doc, parentId));
  const corners: Point[] = [];
  for (const id of top) {
    const n = doc.nodes[id];
    for (const c of cornersOf(worldMatrix(doc, id), n.width, n.height)) corners.push(applyToPoint(parentSpace, c));
  }
  const b = boundsOfPoints(corners);
  const bounds = { x: round2(b.x), y: round2(b.y), width: Math.max(1, round2(b.width)), height: Math.max(1, round2(b.height)) };

  const builder = new OpBuilder(doc);
  const siblingIndexes = top.filter((id) => doc.nodes[id].parentId === parentId).map((id) => indexInParent(doc, id));
  const index = Math.max(...siblingIndexes) + 1;
  const group = createNode('frame', { ...bounds, name: 'Group', fill: null, clip: false }, createId());
  builder.push({ type: 'create', parentId, index, nodes: [group] });
  top.forEach((id, i) => reparentKeepingPosition(builder, id, group.id, i));
  return { ops: builder.ops, groupId: group.id };
}

/** Dissolves frames, moving their children up a level without changing their appearance on the page. */
export function ungroupOps(doc: DesignDocument, ids: readonly string[]): { ops: Op[]; childIds: string[] } | null {
  const frames = topLevelIds(doc, ids).filter((id) => doc.nodes[id]?.type === 'frame');
  if (frames.length === 0) return null;
  const builder = new OpBuilder(doc);
  const childIds: string[] = [];
  for (const frameId of frames) {
    const frame = builder.doc.nodes[frameId];
    const parentId = frame.parentId!;
    const children = [...frame.children];
    children.forEach((childId) => {
      const at = indexInParent(builder.doc, frameId);
      reparentKeepingPosition(builder, childId, parentId, at);
      childIds.push(childId);
    });
    builder.push({ type: 'delete', id: frameId });
  }
  return { ops: builder.ops, childIds };
}

/** Deep-copies subtrees with fresh ids. Returns the copies in pre-order per subtree. */
export function cloneSubtree(doc: DesignDocument, id: string): DesignNode[] {
  return cloneNodes(collectSubtree(doc, id));
}

/** Gives a pre-ordered subtree snapshot fresh ids, keeping its internal structure. */
export function cloneNodes(nodes: readonly DesignNode[]): DesignNode[] {
  const idMap = new Map(nodes.map((n) => [n.id, createId()]));
  return nodes.map((n) => ({
    ...n,
    id: idMap.get(n.id)!,
    parentId: n.parentId && idMap.has(n.parentId) ? idMap.get(n.parentId)! : n.parentId,
    children: n.children.map((c) => idMap.get(c)!),
  }));
}

export function duplicateOps(doc: DesignDocument, ids: readonly string[], offset: Point): { ops: Op[]; newIds: string[] } {
  const top = sortByDocumentOrder(doc, topLevelIds(doc, ids)).filter((id) => id !== doc.rootId);
  const builder = new OpBuilder(doc);
  const newIds: string[] = [];
  for (const id of top) {
    const copy = cloneSubtree(builder.doc, id);
    const root = copy[0];
    copy[0] = { ...root, x: round2(root.x + offset.x), y: round2(root.y + offset.y) };
    const parentId = builder.doc.nodes[id].parentId!;
    builder.push({ type: 'create', parentId, index: indexInParent(builder.doc, id) + 1, nodes: copy });
    newIds.push(root.id);
  }
  return { ops: builder.ops, newIds };
}

/** Moves layers by a world-space delta, converting it into each layer's parent space. */
export function moveByOps(doc: DesignDocument, ids: readonly string[], delta: Point): Op[] {
  return topLevelIds(doc, ids)
    .filter((id) => id !== doc.rootId)
    .map((id) => {
      const node = doc.nodes[id];
      const v = applyToVector(invert(childSpaceMatrix(doc, node.parentId!)), delta);
      return { type: 'update', id, props: { x: round2(node.x + v.x), y: round2(node.y + v.y) } };
    });
}

export type ReorderDirection = 'forward' | 'backward' | 'front' | 'back';

export function reorderOps(doc: DesignDocument, ids: readonly string[], direction: ReorderDirection): Op[] {
  const top = topLevelIds(doc, ids).filter((id) => id !== doc.rootId);
  const selected = new Set(top);
  const parents = new Set(top.map((id) => doc.nodes[id].parentId!));
  const builder = new OpBuilder(doc);

  for (const parentId of parents) {
    const order = [...doc.nodes[parentId].children];
    const isSel = (id: string) => selected.has(id);
    if (direction === 'forward') {
      for (let i = order.length - 2; i >= 0; i--) {
        if (isSel(order[i]) && !isSel(order[i + 1])) [order[i], order[i + 1]] = [order[i + 1], order[i]];
      }
    } else if (direction === 'backward') {
      for (let i = 1; i < order.length; i++) {
        if (isSel(order[i]) && !isSel(order[i - 1])) [order[i], order[i - 1]] = [order[i - 1], order[i]];
      }
    } else if (direction === 'front') {
      order.sort((a, b) => Number(isSel(a)) - Number(isSel(b)));
    } else {
      order.sort((a, b) => Number(isSel(b)) - Number(isSel(a)));
    }
    order.forEach((id, index) => {
      if (builder.doc.nodes[parentId].children[index] !== id) builder.push({ type: 'move', id, parentId, index });
    });
  }
  return builder.ops;
}

export type Alignment = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

/**
 * Aligns layers to the bounds of the selection, or a single layer to its
 * parent frame. Works in world space, so rotated layers align by their
 * visible bounds.
 */
export function alignOps(doc: DesignDocument, ids: readonly string[], alignment: Alignment): Op[] {
  const top = topLevelIds(doc, ids).filter((id) => id !== doc.rootId);
  if (top.length === 0) return [];
  let target: Rect | null;
  if (top.length === 1) {
    const parentId = doc.nodes[top[0]].parentId!;
    if (parentId === doc.rootId) return [];
    const parent = doc.nodes[parentId];
    const m = childSpaceMatrix(doc, parentId);
    const inset = parent.stroke ? parent.strokeWidth : 0;
    target = boundsOfPoints(cornersOf(m, parent.width - inset * 2, parent.height - inset * 2));
  } else {
    target = unionWorldBounds(doc, top);
  }
  if (!target) return [];

  const ops: Op[] = [];
  for (const id of top) {
    const b = worldBounds(doc, id);
    const delta = { x: 0, y: 0 };
    switch (alignment) {
      case 'left':
        delta.x = target.x - b.x;
        break;
      case 'hcenter':
        delta.x = target.x + target.width / 2 - (b.x + b.width / 2);
        break;
      case 'right':
        delta.x = target.x + target.width - (b.x + b.width);
        break;
      case 'top':
        delta.y = target.y - b.y;
        break;
      case 'vcenter':
        delta.y = target.y + target.height / 2 - (b.y + b.height / 2);
        break;
      case 'bottom':
        delta.y = target.y + target.height - (b.y + b.height);
        break;
    }
    if (Math.abs(delta.x) > 1e-6 || Math.abs(delta.y) > 1e-6) ops.push(...moveByOps(doc, [id], delta));
  }
  return ops;
}

/** Spaces three or more layers evenly between the outermost two. */
export function distributeOps(doc: DesignDocument, ids: readonly string[], axis: 'horizontal' | 'vertical'): Op[] {
  const top = topLevelIds(doc, ids).filter((id) => id !== doc.rootId);
  if (top.length < 3) return [];
  const horizontal = axis === 'horizontal';
  const items = top
    .map((id) => ({ id, b: worldBounds(doc, id) }))
    .sort((a, b) =>
      horizontal ? a.b.x + a.b.width / 2 - (b.b.x + b.b.width / 2) : a.b.y + a.b.height / 2 - (b.b.y + b.b.height / 2),
    );
  const start = horizontal ? items[0].b.x : items[0].b.y;
  const last = items[items.length - 1].b;
  const end = horizontal ? last.x + last.width : last.y + last.height;
  const total = items.reduce((sum, it) => sum + (horizontal ? it.b.width : it.b.height), 0);
  const gap = (end - start - total) / (items.length - 1);

  const ops: Op[] = [];
  let cursor = start;
  for (const it of items) {
    const current = horizontal ? it.b.x : it.b.y;
    const d = cursor - current;
    if (Math.abs(d) > 1e-6) ops.push(...moveByOps(doc, [it.id], horizontal ? { x: d, y: 0 } : { x: 0, y: d }));
    cursor += (horizontal ? it.b.width : it.b.height) + gap;
  }
  return ops;
}

// ---------------------------------------------------------------------------
// Clipboard
// ---------------------------------------------------------------------------

export const CLIPBOARD_FORMAT = 'stylecode/layers';

export interface ClipboardItem {
  /** Subtree snapshot, root first. */
  nodes: DesignNode[];
  sourceParentId: string;
  /** World-space centre and rotation of the root, so it can be placed in any container. */
  worldCenter: Point;
  worldRotation: number;
}

export interface ClipboardData {
  format: typeof CLIPBOARD_FORMAT;
  version: 1;
  items: ClipboardItem[];
}

export function copyToClipboardData(doc: DesignDocument, ids: readonly string[]): ClipboardData | null {
  const top = sortByDocumentOrder(doc, topLevelIds(doc, ids)).filter((id) => id !== doc.rootId);
  if (top.length === 0) return null;
  return {
    format: CLIPBOARD_FORMAT,
    version: 1,
    items: top.map((id) => {
      const node = doc.nodes[id];
      const world = worldMatrix(doc, id);
      return {
        nodes: collectSubtree(doc, id),
        sourceParentId: node.parentId!,
        worldCenter: applyToPoint(world, { x: node.width / 2, y: node.height / 2 }),
        worldRotation: matrixRotation(world),
      };
    }),
  };
}

export function isClipboardData(value: unknown): value is ClipboardData {
  const v = value as ClipboardData | null;
  return !!v && v.format === CLIPBOARD_FORMAT && v.version === 1 && Array.isArray(v.items);
}

/**
 * Pastes clipboard layers. Into their original container they keep their
 * position; into a different frame the pasted set is centred in it.
 */
export function pasteOps(doc: DesignDocument, data: ClipboardData, targetId: string | null): { ops: Op[]; newIds: string[] } {
  const builder = new OpBuilder(doc);
  const newIds: string[] = [];
  const items = data.items.filter((it) => it.nodes.length > 0);
  if (items.length === 0) return { ops: [], newIds };

  const target = targetId && isContainer(doc.nodes[targetId]) ? targetId : null;
  let shift = { x: 0, y: 0 };
  if (target && target !== doc.rootId && !items.every((it) => it.sourceParentId === target)) {
    const centers = items.map((it) => it.worldCenter);
    const from = boundsOfPoints(centers);
    const frameBounds = worldBounds(doc, target);
    shift = {
      x: frameBounds.x + frameBounds.width / 2 - (from.x + from.width / 2),
      y: frameBounds.y + frameBounds.height / 2 - (from.y + from.height / 2),
    };
  }

  for (const item of items) {
    const parentId = target ?? (doc.nodes[item.sourceParentId] ? item.sourceParentId : doc.rootId);
    const copy = cloneNodes(item.nodes);
    const root = copy[0];
    const toParent = invert(childSpaceMatrix(builder.doc, parentId));
    const center = applyToPoint(toParent, { x: item.worldCenter.x + shift.x, y: item.worldCenter.y + shift.y });
    const parentRotation = matrixRotation(childSpaceMatrix(builder.doc, parentId));
    copy[0] = {
      ...root,
      parentId,
      x: round2(center.x - root.width / 2),
      y: round2(center.y - root.height / 2),
      rotation: round2(wrapDegrees(item.worldRotation - parentRotation)),
    };
    const parent = builder.doc.nodes[parentId];
    builder.push({ type: 'create', parentId, index: parent.children.length, nodes: copy });
    newIds.push(root.id);
  }
  return { ops: builder.ops, newIds };
}

/** Readable relative luminance (0 = black, 1 = white) of a hex colour. */
export function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const channel = (i: number) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/** The first opaque-ish background colour behind a container, walking up the tree. */
export function backgroundBehind(doc: DesignDocument, containerId: string): string {
  const chain = [containerId, ...getAncestors(doc, containerId)];
  for (const id of chain) {
    const fill = doc.nodes[id]?.fill;
    if (fill && (fill.length === 7 || parseInt(fill.slice(7, 9), 16) > 128)) return fill.slice(0, 7);
  }
  return '#ffffff';
}
