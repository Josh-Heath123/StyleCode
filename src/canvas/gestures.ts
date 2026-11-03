import type { Editor } from '../editor/editor';
import { duplicateOps, moveByOps, reparentKeepingPosition, backgroundBehind, luminance } from '../model/commands';
import { createNode } from '../model/defaults';
import { sortByDocumentOrder, topLevelIds } from '../model/document';
import {
  applyToPoint,
  childSpaceMatrix,
  invert,
  matrixRotation,
  rectFromPoints,
  unionWorldBounds,
  worldMatrix,
} from '../model/geometry';
import { childrenInRect, containerAtPoint } from '../model/hit';
import { createId } from '../model/ids';
import { OpBuilder, type Op } from '../model/ops';
import { localScaleForRotation, resizeBox, rotateByDrag, type Handle } from '../model/transform';
import type { DesignDocument, NodeProps, NodeType, Point } from '../model/types';

/**
 * Pointer gestures on the canvas. Each gesture is a small state machine
 * created on pointer-down and driven by move/up events until it ends.
 * Gestures that change the document preview from a fixed base and commit
 * one undo step at the end.
 */
export interface Gesture {
  move(e: PointerEvent): void;
  up(e: PointerEvent): void;
  cancel(): void;
  /** Cursor to show for the duration of the gesture. */
  cursor?: string;
}

export interface GestureContext {
  editor: Editor;
  /** Converts client (window) coordinates to world coordinates using the current camera. */
  toWorld(clientX: number, clientY: number): Point;
}

const DRAG_THRESHOLD = 3;

function passedThreshold(start: { clientX: number; clientY: number }, e: PointerEvent): boolean {
  return Math.hypot(e.clientX - start.clientX, e.clientY - start.clientY) >= DRAG_THRESHOLD;
}

const round = Math.round;
const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Pan
// ---------------------------------------------------------------------------

export function panGesture(ctx: GestureContext, e: PointerEvent): Gesture {
  const startCam = ctx.editor.getState().camera;
  const sx = e.clientX;
  const sy = e.clientY;
  return {
    cursor: 'grabbing',
    move(ev) {
      ctx.editor.setCamera({ ...startCam, x: startCam.x + ev.clientX - sx, y: startCam.y + ev.clientY - sy });
    },
    up() {},
    cancel() {
      ctx.editor.setCamera(startCam);
    },
  };
}

// ---------------------------------------------------------------------------
// Draw
// ---------------------------------------------------------------------------

export type DrawTool = 'frame' | 'rect' | 'ellipse' | 'text';

const DRAW_LABELS: Record<DrawTool, string> = {
  frame: 'Add frame',
  rect: 'Add rectangle',
  ellipse: 'Add ellipse',
  text: 'Add text',
};

const TYPE_NAMES: Record<DrawTool, string> = { frame: 'Frame', rect: 'Rectangle', ellipse: 'Ellipse', text: 'Text' };

function nextName(doc: DesignDocument, type: NodeType, base: string): string {
  let count = 0;
  for (const node of Object.values(doc.nodes)) if (node.type === type) count++;
  return type === 'text' ? base : `${base} ${count + 1}`;
}

function initialProps(doc: DesignDocument, tool: DrawTool, parentId: string): Partial<NodeProps> {
  const props: Partial<NodeProps> = { name: nextName(doc, tool, TYPE_NAMES[tool]) };
  const darkBehind = luminance(backgroundBehind(doc, parentId)) < 0.35;
  if (tool === 'text') {
    // Pick a readable text colour for whatever the text is drawn on.
    props.fill = darkBehind ? '#f4f6fb' : '#11141a';
    props.text = '';
  } else if (tool === 'frame' && parentId !== doc.rootId) {
    // A section inside a frame gets a gentle tint so it is visible against its parent.
    props.fill = darkBehind ? '#1b2130' : '#f1f3f6';
  }
  return props;
}

/** Puts a freshly created text layer into editing mode; an empty result discards the layer again. */
export function beginTextCreation(editor: Editor, id: string, transactionId: number): void {
  editor.pendingText.set(id, transactionId);
  editor.setEditingText(id);
}

export function drawGesture(ctx: GestureContext, e: PointerEvent, tool: DrawTool): Gesture {
  const { editor } = ctx;
  const base = editor.getState().doc;
  const start = ctx.toWorld(e.clientX, e.clientY);
  const parentId = containerAtPoint(base, start);
  const toParent = invert(childSpaceMatrix(base, parentId));
  const id = createId();
  const props = initialProps(base, tool, parentId);
  const index = base.nodes[parentId].children.length;
  let dragging = false;

  editor.setDropTarget(parentId === base.rootId ? null : parentId);

  const createOp = (extra: Partial<NodeProps>): Op => ({
    type: 'create',
    parentId,
    index,
    nodes: [createNode(tool, { ...props, ...extra }, id)],
  });

  const rectTo = (p: Point, ev: PointerEvent) => {
    let dx = p.x - start.x;
    let dy = p.y - start.y;
    if (ev.shiftKey) {
      const m = Math.max(Math.abs(dx), Math.abs(dy));
      dx = Math.sign(dx || 1) * m;
      dy = Math.sign(dy || 1) * m;
    }
    const a = ev.altKey ? { x: start.x - dx, y: start.y - dy } : start;
    const b = { x: start.x + dx, y: start.y + dy };
    const r = rectFromPoints(applyToPoint(toParent, a), applyToPoint(toParent, b));
    return { x: round(r.x), y: round(r.y), width: Math.max(1, round(r.width)), height: Math.max(1, round(r.height)) };
  };

  const finish = (transactionId: number | undefined) => {
    editor.setDropTarget(null);
    editor.setTool('move');
    if (tool === 'text' && transactionId !== undefined) beginTextCreation(editor, id, transactionId);
  };

  return {
    cursor: 'crosshair',
    move(ev) {
      if (!dragging) {
        if (!passedThreshold(e, ev)) return;
        dragging = true;
        editor.beginGesture();
      }
      const rect = rectTo(ctx.toWorld(ev.clientX, ev.clientY), ev);
      editor.previewGesture([createOp(tool === 'text' ? { ...rect, textResize: 'auto-height' } : rect)], [id]);
    },
    up() {
      if (dragging) {
        const tx = editor.commitGesture(DRAW_LABELS[tool], [id]);
        finish(tx?.id);
        return;
      }
      const p = applyToPoint(toParent, start);
      const extra: Partial<NodeProps> =
        tool === 'text'
          ? { x: round(p.x), y: round(p.y - 11), textResize: 'auto-width' }
          : { x: round(p.x), y: round(p.y), width: 100, height: 100 };
      const tx = editor.apply([createOp(extra)], { label: DRAW_LABELS[tool], selection: [id] });
      finish(tx?.id);
    },
    cancel() {
      editor.cancelGesture();
      editor.setDropTarget(null);
    },
  };
}

// ---------------------------------------------------------------------------
// Move (and Alt-drag to duplicate), with re-parenting on drop
// ---------------------------------------------------------------------------

export interface MoveOptions {
  /** Layer to select on release if the pointer never moved (click inside a multi-selection). */
  selectOnClick?: string;
}

export function moveGesture(ctx: GestureContext, e: PointerEvent, ids: readonly string[], options: MoveOptions = {}): Gesture {
  const { editor } = ctx;
  const base = editor.getState().doc;
  const top = sortByDocumentOrder(base, topLevelIds(base, ids)).filter((id) => id !== base.rootId && !base.nodes[id].locked);
  const start = ctx.toWorld(e.clientX, e.clientY);
  const exclude = new Set(top);
  let dragging = false;
  let duplicate: { ops: Op[]; newIds: string[] } | null = null;
  let target: string | null = null;
  let lastDelta: Point = { x: 0, y: 0 };

  const build = (delta: Point, withReparent: boolean) => {
    const builder = new OpBuilder(base);
    let moving = top;
    if (duplicate) {
      builder.push(...duplicate.ops);
      moving = duplicate.newIds;
    }
    builder.push(...moveByOps(builder.doc, moving, delta));
    let reparented = false;
    if (withReparent && target) {
      for (const id of moving) {
        if (builder.doc.nodes[id].parentId !== target) {
          reparentKeepingPosition(builder, id, target, builder.doc.nodes[target].children.length);
          reparented = true;
        }
      }
    }
    return { ops: builder.ops, moving, reparented, doc: builder.doc };
  };

  return {
    move(ev) {
      if (top.length === 0) return;
      if (!dragging) {
        if (!passedThreshold(e, ev)) return;
        dragging = true;
        if (ev.altKey || e.altKey) duplicate = duplicateOps(base, top, { x: 0, y: 0 });
        editor.beginGesture();
      }
      const p = ctx.toWorld(ev.clientX, ev.clientY);
      let delta = { x: round(p.x - start.x), y: round(p.y - start.y) };
      if (ev.shiftKey) delta = Math.abs(delta.x) >= Math.abs(delta.y) ? { x: delta.x, y: 0 } : { x: 0, y: delta.y };
      lastDelta = delta;

      // Re-parent live, so a layer dragged out of a clipping frame stays visible.
      target = containerAtPoint(base, p, exclude);
      const { ops, moving } = build(delta, true);
      const changesParent = top.some((id) => base.nodes[id].parentId !== target);
      editor.setDropTarget(changesParent && target !== base.rootId ? target : null);
      editor.previewGesture(ops, moving);
    },
    up() {
      if (!dragging) {
        if (options.selectOnClick) editor.select([options.selectOnClick]);
        return;
      }
      const { ops, moving, reparented } = build(lastDelta, true);
      editor.previewGesture(ops, moving);
      editor.commitGesture(duplicate ? 'Duplicate' : reparented ? 'Move into frame' : 'Move', moving);
    },
    cancel() {
      editor.cancelGesture();
    },
  };
}

// ---------------------------------------------------------------------------
// Marquee selection
// ---------------------------------------------------------------------------

export function marqueeGesture(ctx: GestureContext, e: PointerEvent, scopeId: string, additive: boolean): Gesture {
  const { editor } = ctx;
  const initial = additive ? [...editor.getState().selection] : [];
  if (!additive) editor.select([]);
  const start = ctx.toWorld(e.clientX, e.clientY);
  let dragging = false;
  return {
    move(ev) {
      if (!dragging) {
        if (!passedThreshold(e, ev)) return;
        dragging = true;
      }
      const rect = rectFromPoints(start, ctx.toWorld(ev.clientX, ev.clientY));
      editor.setMarquee(rect);
      const hits = childrenInRect(editor.getState().doc, scopeId, rect);
      editor.select(additive ? [...new Set([...initial, ...hits])] : hits);
    },
    up() {
      editor.setMarquee(null);
    },
    cancel() {
      editor.setMarquee(null);
      editor.select(initial);
    },
  };
}

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------

export const HANDLES = {
  nw: { hx: -1, hy: -1 },
  n: { hx: 0, hy: -1 },
  ne: { hx: 1, hy: -1 },
  e: { hx: 1, hy: 0 },
  se: { hx: 1, hy: 1 },
  s: { hx: 0, hy: 1 },
  sw: { hx: -1, hy: 1 },
  w: { hx: -1, hy: 0 },
} as const satisfies Record<string, Handle>;

export type HandleName = keyof typeof HANDLES;

export function resizeGesture(ctx: GestureContext, ids: readonly string[], handleName: HandleName, cursor: string): Gesture {
  const { editor } = ctx;
  const base = editor.getState().doc;
  const top = topLevelIds(base, ids).filter((id) => id !== base.rootId && !base.nodes[id].locked);
  const handle = HANDLES[handleName];
  editor.beginGesture();

  if (top.length === 1) {
    const node = base.nodes[top[0]];
    const toParent = invert(childSpaceMatrix(base, node.parentId!));
    const exact = node.rotation === 0 && matrixRotation(childSpaceMatrix(base, node.parentId!)) === 0;
    return {
      cursor,
      move(ev) {
        const p = applyToPoint(toParent, ctx.toWorld(ev.clientX, ev.clientY));
        const r = resizeBox(node, handle, p, { keepAspect: ev.shiftKey, fromCenter: ev.altKey });
        const rr = exact
          ? { x: round(r.x), y: round(r.y), width: Math.max(1, round(r.width)), height: Math.max(1, round(r.height)) }
          : { x: round2(r.x), y: round2(r.y), width: round2(r.width), height: round2(r.height) };
        const props: Partial<NodeProps> = rr;
        if (node.type === 'text') {
          // Dragging a text box's height fixes it; dragging its width makes it wrap.
          if (handle.hy !== 0) props.textResize = 'fixed';
          else if (node.textResize === 'auto-width') props.textResize = 'auto-height';
        }
        editor.previewGesture([{ type: 'update', id: node.id, props }]);
      },
      up() {
        editor.commitGesture('Resize');
      },
      cancel() {
        editor.cancelGesture();
      },
    };
  }

  // Several layers: scale their positions and sizes within the selection bounds.
  const bounds = unionWorldBounds(base, top)!;
  const items = top.map((id) => {
    const node = base.nodes[id];
    const world = worldMatrix(base, id);
    return {
      node,
      center: applyToPoint(world, { x: node.width / 2, y: node.height / 2 }),
      worldRotation: matrixRotation(world),
      toParent: invert(childSpaceMatrix(base, node.parentId!)),
    };
  });
  return {
    cursor,
    move(ev) {
      const p = ctx.toWorld(ev.clientX, ev.clientY);
      const nb = resizeBox({ ...bounds, rotation: 0 }, handle, p, { keepAspect: ev.shiftKey, fromCenter: ev.altKey });
      const sx = nb.width / Math.max(1e-6, bounds.width);
      const sy = nb.height / Math.max(1e-6, bounds.height);
      const ops: Op[] = items.map(({ node, center, worldRotation, toParent }) => {
        const c = { x: nb.x + (center.x - bounds.x) * sx, y: nb.y + (center.y - bounds.y) * sy };
        const { sw, sh } = localScaleForRotation(worldRotation, sx, sy);
        const width = Math.max(1, round2(node.width * sw));
        const height = Math.max(1, round2(node.height * sh));
        const local = applyToPoint(toParent, c);
        const props: Partial<NodeProps> = { x: round2(local.x - width / 2), y: round2(local.y - height / 2), width, height };
        if (node.type === 'text') props.textResize = 'fixed';
        return { type: 'update', id: node.id, props };
      });
      editor.previewGesture(ops);
    },
    up() {
      editor.commitGesture('Resize');
    },
    cancel() {
      editor.cancelGesture();
    },
  };
}

// ---------------------------------------------------------------------------
// Rotate
// ---------------------------------------------------------------------------

export function rotateGesture(ctx: GestureContext, e: PointerEvent, id: string, cursor: string): Gesture {
  const { editor } = ctx;
  const base = editor.getState().doc;
  const node = base.nodes[id];
  const center = applyToPoint(worldMatrix(base, id), { x: node.width / 2, y: node.height / 2 });
  const start = ctx.toWorld(e.clientX, e.clientY);
  editor.beginGesture();
  return {
    cursor,
    move(ev) {
      const rotation = rotateByDrag(node.rotation, center, start, ctx.toWorld(ev.clientX, ev.clientY), ev.shiftKey ? 15 : 0);
      editor.previewGesture([{ type: 'update', id, props: { rotation: round2(rotation) } }]);
    },
    up() {
      editor.commitGesture('Rotate');
    },
    cancel() {
      editor.cancelGesture();
    },
  };
}
