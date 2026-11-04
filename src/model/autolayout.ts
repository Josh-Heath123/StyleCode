import { reparentKeepingPosition } from './commands';
import { createNode } from './defaults';
import { indexInParent, sortByDocumentOrder, topLevelIds } from './document';
import {
  applyToPoint,
  boundsOfPoints,
  childSpaceMatrix,
  contentOffset,
  cornersOf,
  invert,
  localMatrix,
  worldMatrix,
} from './geometry';
import { createId } from './ids';
import { arrange, type Arrangement, type LayoutItem } from './infer';
import { isAutoLayout } from './layout';
import { OpBuilder, type Op } from './ops';
import type { DesignDocument, NodeProps, Point, Rect } from './types';

/**
 * Commands for auto-layout: tidying freely placed layers into rows and
 * columns, wrapping a selection in an auto-layout frame, removing auto-layout,
 * and finding where a dragged layer would land in a row or column.
 */

export type TidyResult = { ok: true; ops: Op[]; frameId: string } | { ok: false; error: string };

const OVERLAP_ERROR = "These layers overlap, so they can't be arranged into rows or columns. Move them apart first.";

const round = Math.round;

/** How far off-centre (in px) a single layer can be and still count as centred. */
const CENTRE_TOLERANCE = 2;

/** A layer's visible bounds in its parent's content space. */
function boxInParent(doc: DesignDocument, id: string): Rect {
  const node = doc.nodes[id];
  return boundsOfPoints(cornersOf(localMatrix(node), node.width, node.height));
}

/** Creates the frames an arrangement needs inside `parentId` and returns the ids, in flow order. */
function materialize(b: OpBuilder, item: Arrangement, parentId: string, origin: Point): string {
  if (item.kind === 'leaf') {
    if (b.doc.nodes[item.id].parentId !== parentId) {
      reparentKeepingPosition(b, item.id, parentId, b.doc.nodes[parentId].children.length);
    }
    return item.id;
  }

  const id = createId();
  const common: Partial<NodeProps> = {
    x: round(item.box.x - origin.x),
    y: round(item.box.y - origin.y),
    width: Math.max(1, round(item.box.width)),
    height: Math.max(1, round(item.box.height)),
    fill: null,
    clip: false,
  };
  if (item.kind === 'freeform') {
    // Overlapping layers stay exactly as drawn, inside a plain group that joins the flow.
    b.push({
      type: 'create',
      parentId,
      index: b.doc.nodes[parentId].children.length,
      nodes: [createNode('frame', { ...common, name: 'Group' }, id)],
    });
    for (const leaf of item.items) reparentKeepingPosition(b, leaf.id, id, b.doc.nodes[id].children.length);
    return id;
  }

  const frame = createNode(
    'frame',
    {
      ...common,
      name: item.direction === 'row' ? 'Row' : 'Column',
      layout: item.direction,
      gap: item.typicalGap,
      align: item.align,
      widthMode: 'hug',
      heightMode: 'hug',
    },
    id,
  );
  b.push({ type: 'create', parentId, index: b.doc.nodes[parentId].children.length, nodes: [frame] });
  const order = item.items.map((child) => materialize(b, child, id, { x: item.box.x, y: item.box.y }));
  setOrder(b, id, order);
  return id;
}

/** Re-orders a container's children so `first` come first, in that order, followed by the rest. */
function setOrder(b: OpBuilder, parentId: string, first: readonly string[]): void {
  const rest = b.doc.nodes[parentId].children.filter((c) => !first.includes(c));
  const target = [...first, ...rest];
  target.forEach((id, index) => {
    if (b.doc.nodes[parentId].children[index] !== id) b.push({ type: 'move', id, parentId, index });
  });
}

function tidyInto(b: OpBuilder, frameId: string): string | null {
  const frame = b.doc.nodes[frameId];
  const flow = frame.children.filter((id) => b.doc.nodes[id].visible && b.doc.nodes[id].positioning !== 'absolute');

  if (flow.length === 0) {
    b.push({
      type: 'update',
      id: frameId,
      props: {
        layout: 'column',
        gap: 16,
        paddingTop: 16,
        paddingRight: 16,
        paddingBottom: 16,
        paddingLeft: 16,
        align: 'start',
        justify: 'start',
      },
    });
    return null;
  }

  const items: LayoutItem[] = flow.map((id) => ({ id, box: boxInParent(b.doc, id) }));
  const arrangement = arrange(items);
  if (arrangement.kind === 'freeform') return OVERLAP_ERROR;

  const top =
    arrangement.kind === 'stack'
      ? arrangement
      : {
          direction: 'column' as const,
          gap: 0,
          align: 'start' as const,
          spread: false,
          items: [arrangement],
          box: arrangement.box,
        };

  // Padding is the distance from the frame's inner edges to the content, so nothing moves more than it must.
  const inset = contentOffset(frame) * 2;
  const innerW = frame.width - inset;
  const innerH = frame.height - inset;
  const box = top.box;
  let padTop = Math.max(0, round(box.y));
  let padLeft = Math.max(0, round(box.x));
  let padBottom = Math.max(0, round(innerH - (box.y + box.height)));
  let padRight = Math.max(0, round(innerW - (box.x + box.width)));
  let layout = top.direction;
  let align = top.align;
  let justify: 'start' | 'center' | 'space-between' = top.spread ? 'space-between' : 'start';

  // A single layer sitting in the middle (a label in a button, an icon in a tile) is centred
  // for real, so it stays centred when the frame or the layer changes size.
  if (arrangement.kind === 'leaf') {
    const centredX = Math.abs(padLeft - padRight) <= CENTRE_TOLERANCE;
    const centredY = Math.abs(padTop - padBottom) <= CENTRE_TOLERANCE;
    if (centredX || centredY) {
      layout = 'row';
      if (centredX) {
        justify = 'center';
        padLeft = padRight = Math.min(padLeft, padRight);
      }
      if (centredY) {
        align = 'center';
        padTop = padBottom = Math.min(padTop, padBottom);
      }
    }
  }

  b.push({
    type: 'update',
    id: frameId,
    props: {
      layout,
      gap: top.gap,
      align,
      justify,
      paddingTop: padTop,
      paddingLeft: padLeft,
      paddingBottom: padBottom,
      paddingRight: padRight,
    },
  });
  const order = top.items.map((item) => materialize(b, item, frameId, { x: 0, y: 0 }));
  setOrder(b, frameId, order);

  // Frames inside that are still freely arranged get tidied too, so one command structures a
  // whole sketch. A frame whose layers overlap is simply left as it is.
  for (const id of collectLeaves(top.items)) {
    const child = b.doc.nodes[id];
    if (child.type === 'frame' && child.layout === 'none' && child.children.length > 0) {
      const attempt = new OpBuilder(b.doc);
      if (tidyInto(attempt, id) === null) b.push(...attempt.ops);
    }
  }
  return null;
}

function collectLeaves(items: readonly Arrangement[]): string[] {
  return items.flatMap((item) => (item.kind === 'leaf' ? [item.id] : item.kind === 'stack' ? collectLeaves(item.items) : []));
}

/** Turns a frame's freely placed children into an inferred row/column structure. */
export function tidyFrameOps(doc: DesignDocument, frameId: string): TidyResult {
  const frame = doc.nodes[frameId];
  if (frame?.type !== 'frame') return { ok: false, error: 'Select a frame to tidy.' };
  const b = new OpBuilder(doc);
  const error = tidyInto(b, frameId);
  return error ? { ok: false, error } : { ok: true, ops: b.ops, frameId };
}

/** Wraps layers in a new auto-layout frame that hugs them, arranged as inferred from their positions. */
export function wrapInAutoLayoutOps(doc: DesignDocument, ids: readonly string[]): TidyResult {
  const chosen = sortByDocumentOrder(doc, topLevelIds(doc, ids)).filter((id) => id !== doc.rootId);
  // Notes stay on the canvas, outside layouts.
  const top = chosen.filter((id) => doc.nodes[id]?.type !== 'note');
  if (top.length === 0) {
    return {
      ok: false,
      error: chosen.length ? 'Notes stay outside layouts. Select the layers to arrange.' : 'Select some layers first.',
    };
  }
  const parentId = doc.nodes[top[top.length - 1]].parentId!;

  const toParent = invert(childSpaceMatrix(doc, parentId));
  const corners: Point[] = [];
  for (const id of top) {
    const n = doc.nodes[id];
    for (const c of cornersOf(worldMatrix(doc, id), n.width, n.height)) corners.push(applyToPoint(toParent, c));
  }
  const bounds = boundsOfPoints(corners);

  const b = new OpBuilder(doc);
  const siblings = top.filter((id) => doc.nodes[id].parentId === parentId).map((id) => indexInParent(doc, id));
  const frameId = createId();
  const frame = createNode(
    'frame',
    {
      name: 'Auto layout',
      x: round(bounds.x),
      y: round(bounds.y),
      width: Math.max(1, round(bounds.width)),
      height: Math.max(1, round(bounds.height)),
      fill: null,
      clip: false,
      widthMode: 'hug',
      heightMode: 'hug',
    },
    frameId,
  );
  b.push({ type: 'create', parentId, index: Math.max(...siblings) + 1, nodes: [frame] });
  top.forEach((id, i) => reparentKeepingPosition(b, id, frameId, i));

  const error = tidyInto(b, frameId);
  if (error) return { ok: false, error };
  const direction = b.doc.nodes[frameId].layout;
  b.push({ type: 'update', id: frameId, props: { name: direction === 'row' ? 'Row' : 'Column' } });
  return { ok: true, ops: b.ops, frameId };
}

/**
 * Switches auto-layout off. Children keep the positions the layout gave them.
 * A frame that hugged its content keeps its current size; one that fills its
 * own auto-layout parent still does.
 */
export function removeAutoLayoutOps(doc: DesignDocument, ids: readonly string[]): Op[] {
  return ids
    .filter((id) => isAutoLayout(doc.nodes[id]))
    .map((id) => {
      const node = doc.nodes[id];
      const props: Partial<NodeProps> = { layout: 'none' };
      if (node.widthMode === 'hug') props.widthMode = 'fixed';
      if (node.heightMode === 'hug') props.heightMode = 'fixed';
      return { type: 'update', id, props };
    });
}

/**
 * Where a layer dragged to `point` (in the frame's content space) would be
 * inserted among the frame's flow children: an index into `children`, plus
 * the insertion line to show, in the same space.
 */
export function flowInsertion(
  doc: DesignDocument,
  frameId: string,
  point: Point,
  exclude: ReadonlySet<string>,
): { index: number; line: { x1: number; y1: number; x2: number; y2: number } } {
  const frame = doc.nodes[frameId];
  const row = frame.layout === 'row';
  const flow = frame.children.filter(
    (id) => !exclude.has(id) && doc.nodes[id].visible && doc.nodes[id].positioning !== 'absolute',
  );
  const inset = contentOffset(frame) * 2;
  const crossStart = row ? frame.paddingTop : frame.paddingLeft;
  const crossEnd = (row ? frame.height : frame.width) - inset - (row ? frame.paddingBottom : frame.paddingRight);

  let before: string | null = null;
  for (const id of flow) {
    const n = doc.nodes[id];
    const mid = row ? n.x + n.width / 2 : n.y + n.height / 2;
    if ((row ? point.x : point.y) < mid) {
      before = id;
      break;
    }
  }

  // Line position: halfway into the gap before `before`, or after the last item.
  let at: number;
  if (before) {
    const n = doc.nodes[before];
    at = (row ? n.x : n.y) - frame.gap / 2;
  } else if (flow.length) {
    const n = doc.nodes[flow[flow.length - 1]];
    at = (row ? n.x + n.width : n.y + n.height) + frame.gap / 2;
  } else {
    at = row ? frame.paddingLeft : frame.paddingTop;
  }
  const line = row ? { x1: at, y1: crossStart, x2: at, y2: crossEnd } : { x1: crossStart, y1: at, x2: crossEnd, y2: at };

  const children = frame.children.filter((id) => !exclude.has(id));
  const index = before ? children.indexOf(before) : flow.length ? children.indexOf(flow[flow.length - 1]) + 1 : children.length;
  return { index, line };
}
