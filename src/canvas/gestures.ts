import type { Editor, Guide } from '../editor/editor';
import { flowInsertion } from '../model/autolayout';
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
  worldBounds,
  worldMatrix,
} from '../model/geometry';
import { childrenInRect, containerAtPoint, isSelectable } from '../model/hit';
import { createId } from '../model/ids';
import { isAutoLayout, isInFlow } from '../model/layout';
import { OpBuilder, type Op } from '../model/ops';
import { localScaleForRotation, resizeBox, rotateByDrag, type Handle } from '../model/transform';
import type { DesignDocument, NodeProps, NodeType, Point, Rect } from '../model/types';
import { snapBox, snapPoint, snapTargets, SNAP_DISTANCE, type SnapTargets } from './snapping';

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

/** Snapping is on unless Ctrl/⌘ is held during the drag. */
const snapping = (ev: PointerEvent) => !(ev.ctrlKey || ev.metaKey);
const snapThreshold = (editor: Editor) => SNAP_DISTANCE / editor.getState().camera.zoom;

/** Converts an insertion line from a frame's content space to world space. */
function lineToWorld(doc: DesignDocument, frameId: string, line: { x1: number; y1: number; x2: number; y2: number }): Guide {
  const m = childSpaceMatrix(doc, frameId);
  const a = applyToPoint(m, { x: line.x1, y: line.y1 });
  const b = applyToPoint(m, { x: line.x2, y: line.y2 });
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y, kind: 'insert' };
}

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
  const rawStart = ctx.toWorld(e.clientX, e.clientY);
  const parentId = containerAtPoint(base, rawStart);
  const inLayout = isAutoLayout(base.nodes[parentId]);
  const targets = inLayout ? null : snapTargets(base, parentId, new Set());
  const start = targets && snapping(e) ? snapPoint(rawStart, targets, snapThreshold(editor)).point : rawStart;
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

  const rectTo = (raw: Point, ev: PointerEvent) => {
    let p = raw;
    let guides: Guide[] = [];
    if (targets && snapping(ev) && !ev.shiftKey && !ev.altKey) {
      const snapped = snapPoint(raw, targets, snapThreshold(editor));
      p = snapped.point;
      guides = snapped.guides;
    }
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
    return {
      rect: { x: round(r.x), y: round(r.y), width: Math.max(1, round(r.width)), height: Math.max(1, round(r.height)) },
      guides,
    };
  };

  const finish = (transactionId: number | undefined) => {
    editor.setDropTarget(null);
    editor.setGuides([]);
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
      // The editor refused the edit (an AI proposal is under review): show nothing.
      if (!editor.inGesture) return;
      const { rect, guides } = rectTo(ctx.toWorld(ev.clientX, ev.clientY), ev);
      editor.previewGesture([createOp(tool === 'text' ? { ...rect, textResize: 'auto-height' } : rect)], [id]);
      editor.setGuides(guides);
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
      editor.setGuides([]);
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
  const startBounds: Rect | null = unionWorldBounds(base, top);
  const targetCache = new Map<string, SnapTargets>();
  let dragging = false;
  let duplicate: { ops: Op[]; newIds: string[] } | null = null;
  let target: string | null = null;
  /** In an auto-layout frame: the child the moved layers are inserted before (null = at the end). */
  let anchor: string | null = null;
  let lastDelta: Point = { x: 0, y: 0 };

  // Notes stay on the canvas: a selection with notes in it moves without changing any parents.
  const keepParents = top.some((id) => base.nodes[id].type === 'note');

  // Layers the user deliberately positioned absolutely inside an auto-layout frame move freely there.
  const freeIn = (frameId: string) =>
    top.every((id) => base.nodes[id].parentId === frameId && base.nodes[id].positioning === 'absolute');
  const reorders = (frameId: string | null) => !!frameId && isAutoLayout(base.nodes[frameId]) && !freeIn(frameId);

  // Layers in a row or column are being reordered among their siblings. Passing over a sibling
  // frame they could not fit inside (one card over another) keeps reordering instead of
  // dropping into it; a smaller layer can still be dropped into a bigger sibling.
  const flowParent =
    top.length > 0 && top.every((id) => base.nodes[id].parentId === base.nodes[top[0]].parentId && isInFlow(base, base.nodes[id]))
      ? base.nodes[top[0]].parentId
      : null;
  const resolveTarget = (found: string): string => {
    if (!flowParent || !startBounds || found === flowParent) return found;
    let sibling = found;
    while (base.nodes[sibling].parentId && base.nodes[sibling].parentId !== flowParent) sibling = base.nodes[sibling].parentId!;
    if (base.nodes[sibling].parentId !== flowParent) return found;
    const room = worldBounds(base, sibling);
    const fits = startBounds.width < room.width && startBounds.height < room.height;
    return fits ? found : flowParent;
  };

  const targetsFor = (containerId: string) => {
    let t = targetCache.get(containerId);
    if (!t) {
      t = snapTargets(base, containerId, duplicate ? new Set() : exclude);
      targetCache.set(containerId, t);
    }
    return t;
  };

  const build = (delta: Point, final: boolean) => {
    const builder = new OpBuilder(base);
    let moving = top;
    if (duplicate) {
      builder.push(...duplicate.ops);
      moving = duplicate.newIds;
    }
    // Each push copies the whole document, which adds up on large ones, so operations that
    // don't change what is read in between (positions, positioning) are pushed together.
    let pending: Op[] = moveByOps(builder.doc, moving, delta);
    const flush = () => {
      if (pending.length) builder.push(...pending);
      pending = [];
    };
    let reparented = false;
    if (target) {
      for (const id of moving) {
        if (builder.doc.nodes[id].parentId !== target) {
          flush();
          reparentKeepingPosition(builder, id, target, builder.doc.nodes[target].children.length);
          reparented = true;
        }
      }
      if (!isAutoLayout(builder.doc.nodes[target])) {
        // Outside auto-layout, "absolute" has no meaning; clear it so the layer joins any flow it enters later.
        for (const id of moving) {
          if (builder.doc.nodes[id].positioning === 'absolute')
            pending.push({ type: 'update', id, props: { positioning: 'auto' } });
        }
      }
      if (reorders(target)) {
        if (!final) {
          // While dragging, lift the layers out of the flow so they follow the pointer and the
          // rest of the row or column closes up around the gap.
          for (const id of moving) pending.push({ type: 'update', id, props: { positioning: 'absolute' } });
        } else {
          flush();
          for (const id of moving) {
            const siblings = builder.doc.nodes[target].children.filter((c) => c !== id);
            const index = anchor && siblings.includes(anchor) ? siblings.indexOf(anchor) : siblings.length;
            builder.push({ type: 'move', id, parentId: target, index });
            builder.push({ type: 'update', id, props: { positioning: 'auto' } });
          }
        }
      }
    }
    flush();
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
      // The editor refused the edit (an AI proposal is under review): show nothing.
      if (!editor.inGesture) return;
      const p = ctx.toWorld(ev.clientX, ev.clientY);
      let delta = { x: p.x - start.x, y: p.y - start.y };
      if (ev.shiftKey) delta = Math.abs(delta.x) >= Math.abs(delta.y) ? { x: delta.x, y: 0 } : { x: 0, y: delta.y };
      target = keepParents ? null : resolveTarget(containerAtPoint(base, p, exclude));

      let guides: Guide[] = [];
      if (!reorders(target) && startBounds && snapping(ev)) {
        const moved = { ...startBounds, x: startBounds.x + delta.x, y: startBounds.y + delta.y };
        const snap = snapBox(moved, targetsFor(target ?? base.rootId), snapThreshold(editor));
        if (!(ev.shiftKey && delta.y === 0)) delta.y += snap.dy;
        if (!(ev.shiftKey && delta.x === 0)) delta.x += snap.dx;
        guides = snap.guides;
      }
      delta = { x: snap2(delta.x), y: snap2(delta.y) };
      lastDelta = delta;

      // Re-parent live, so a layer dragged out of a clipping frame stays visible.
      const { ops, moving, doc: applied } = build(delta, false);
      const changesParent = top.some((id) => base.nodes[id].parentId !== target);
      editor.setDropTarget(changesParent && target !== base.rootId ? target : null);
      editor.previewGesture(ops, moving, applied);

      if (target && reorders(target)) {
        const doc = editor.getState().doc;
        const local = applyToPoint(invert(childSpaceMatrix(doc, target)), p);
        const movingSet = new Set(moving);
        const insertion = flowInsertion(doc, target, local, movingSet);
        const siblings = doc.nodes[target].children.filter((c) => !movingSet.has(c));
        anchor = siblings[insertion.index] ?? null;
        guides = [lineToWorld(doc, target, insertion.line)];
      }
      editor.setGuides(guides);
    },
    up() {
      if (!dragging) {
        if (options.selectOnClick) editor.select([options.selectOnClick]);
        return;
      }
      const { ops, moving, reparented } = build(lastDelta, true);
      editor.previewGesture(ops, moving);
      const label = duplicate ? 'Duplicate' : reorders(target) ? 'Reorder' : reparented ? 'Move into frame' : 'Move';
      editor.commitGesture(label, moving);
    },
    cancel() {
      editor.cancelGesture();
    },
  };
}

/** Whole pixels when not snapped to something fractional. */
function snap2(n: number): number {
  const r = Math.round(n);
  return Math.abs(r - n) < 0.01 ? r : round2(n);
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

/**
 * The Note tool. Dragging draws a note; clicking a layer pins a note to it
 * (the note points at that layer); clicking empty canvas drops a note there.
 * Notes always sit on the canvas itself, outside frames. Typing starts at
 * once, and a note left empty is removed again.
 */
export function noteGesture(ctx: GestureContext, e: PointerEvent, pinTo: string | null): Gesture {
  const { editor } = ctx;
  const base = editor.getState().doc;
  const start = ctx.toWorld(e.clientX, e.clientY);
  const id = createId();
  const count = Object.values(base.nodes).filter((n) => n.type === 'note').length;
  const props: Partial<NodeProps> = { name: `Note ${count + 1}` };
  let dragging = false;
  const createOp = (extra: Partial<NodeProps>): Op => ({
    type: 'create',
    parentId: base.rootId,
    index: base.nodes[base.rootId].children.length,
    nodes: [createNode('note', { ...props, ...extra }, id)],
  });
  const finish = (transactionId: number | undefined) => {
    editor.setTool('move');
    if (transactionId !== undefined) beginTextCreation(editor, id, transactionId);
  };
  return {
    cursor: 'crosshair',
    move(ev) {
      if (!dragging) {
        if (!passedThreshold(e, ev)) return;
        dragging = true;
        editor.beginGesture();
      }
      if (!editor.inGesture) return;
      const r = rectFromPoints(start, ctx.toWorld(ev.clientX, ev.clientY));
      editor.previewGesture([createOp({ x: round(r.x), y: round(r.y), width: Math.max(120, round(r.width)) })], [id]);
    },
    up() {
      if (dragging) {
        finish(editor.commitGesture('Add note', [id])?.id);
        return;
      }
      // Pinned to a layer: above it, a little to the right of where it was clicked, pointing back at it.
      const at = pinTo
        ? { x: round(start.x + 48), y: round(Math.min(start.y, worldBounds(base, pinTo).y) - 136) }
        : { x: round(start.x), y: round(start.y) };
      const tx = editor.apply([createOp({ ...at, noteTarget: pinTo ?? '' })], { label: 'Add note', selection: [id] });
      finish(tx?.id);
    },
    cancel() {
      editor.cancelGesture();
    },
  };
}

/** The layer a point is over that a note may point at: the deepest design layer, never a note. */
function noteTargetAt(doc: DesignDocument, clientX: number, clientY: number, noteId: string): string | null {
  for (const el of document.elementsFromPoint(clientX, clientY)) {
    const id = el.closest('[data-node-id]')?.getAttribute('data-node-id');
    if (!id || id === noteId || !doc.nodes[id] || doc.nodes[id].type === 'note' || !isSelectable(doc, id)) continue;
    return id;
  }
  return null;
}

/** Dragging the dot on a note's edge onto a layer makes the note point at it. */
export function connectGesture(ctx: GestureContext, noteId: string, from: Point): Gesture {
  const { editor } = ctx;
  let target: string | null = null;
  return {
    cursor: 'crosshair',
    move(ev) {
      const doc = editor.getState().doc;
      const p = ctx.toWorld(ev.clientX, ev.clientY);
      target = noteTargetAt(doc, ev.clientX, ev.clientY, noteId);
      editor.setDropTarget(target);
      editor.setGuides([{ x1: from.x, y1: from.y, x2: p.x, y2: p.y, kind: 'connector' }]);
    },
    up() {
      editor.setDropTarget(null);
      editor.setGuides([]);
      if (target)
        editor.apply([{ type: 'update', id: noteId, props: { noteTarget: target } }], {
          label: 'Point note',
          selection: [noteId],
        });
    },
    cancel() {
      editor.setDropTarget(null);
      editor.setGuides([]);
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

/**
 * Resizing a dimension by hand makes it fixed: a filling or hugging layer
 * stops filling or hugging along the axes the handle changes.
 */
function fixedSizing(node: DesignDocument['nodes'][string], handle: Handle): Partial<NodeProps> {
  const props: Partial<NodeProps> = {};
  if (handle.hx !== 0 && node.widthMode !== 'fixed') props.widthMode = 'fixed';
  if (handle.hy !== 0 && node.heightMode !== 'fixed') props.heightMode = 'fixed';
  return props;
}

export function resizeGesture(ctx: GestureContext, ids: readonly string[], handleName: HandleName, cursor: string): Gesture {
  const { editor } = ctx;
  const base = editor.getState().doc;
  const top = topLevelIds(base, ids).filter((id) => id !== base.rootId && !base.nodes[id].locked);
  const handle = HANDLES[handleName];
  editor.beginGesture();

  if (top.length === 1) {
    const node = base.nodes[top[0]];
    const parentSpace = childSpaceMatrix(base, node.parentId!);
    const toParent = invert(parentSpace);
    const exact = node.rotation === 0 && matrixRotation(parentSpace) === 0;
    const flow = isInFlow(base, node);
    const targets = exact && !flow ? snapTargets(base, node.parentId!, new Set([node.id])) : null;
    return {
      cursor,
      move(ev) {
        if (!editor.inGesture) return;
        const p = applyToPoint(toParent, ctx.toWorld(ev.clientX, ev.clientY));
        const r = resizeBox(node, handle, p, { keepAspect: ev.shiftKey, fromCenter: ev.altKey });
        let rr = exact
          ? { x: round(r.x), y: round(r.y), width: Math.max(1, round(r.width)), height: Math.max(1, round(r.height)) }
          : { x: round2(r.x), y: round2(r.y), width: round2(r.width), height: round2(r.height) };
        let guides: Guide[] = [];
        if (targets && snapping(ev) && !ev.shiftKey && !ev.altKey) {
          // Only the dragged edges snap. The parent is unrotated here, so world = parent space + offset.
          const origin = applyToPoint(parentSpace, { x: 0, y: 0 });
          const world = { x: rr.x + origin.x, y: rr.y + origin.y, width: rr.width, height: rr.height };
          const edge = (h: -1 | 0 | 1) => (h === 1 ? ['end' as const] : h === -1 ? ['start' as const] : []);
          const snap = snapBox(world, targets, snapThreshold(editor), { x: edge(handle.hx), y: edge(handle.hy) });
          if (handle.hx === 1) rr = { ...rr, width: Math.max(1, round2(rr.width + snap.dx)) };
          if (handle.hx === -1) rr = { ...rr, x: round2(rr.x + snap.dx), width: Math.max(1, round2(rr.width - snap.dx)) };
          if (handle.hy === 1) rr = { ...rr, height: Math.max(1, round2(rr.height + snap.dy)) };
          if (handle.hy === -1) rr = { ...rr, y: round2(rr.y + snap.dy), height: Math.max(1, round2(rr.height - snap.dy)) };
          guides = snap.guides;
        }
        const props: Partial<NodeProps> = { ...rr, ...fixedSizing(node, handle) };
        if (node.type === 'text') {
          // Dragging a text box's height fixes it; dragging its width makes it wrap.
          if (handle.hy !== 0) props.textResize = 'fixed';
          else if (node.textResize === 'auto-width') props.textResize = 'auto-height';
        }
        editor.previewGesture([{ type: 'update', id: node.id, props }]);
        editor.setGuides(guides);
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
      if (!editor.inGesture) return;
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
        const props: Partial<NodeProps> = {
          x: round2(local.x - width / 2),
          y: round2(local.y - height / 2),
          width,
          height,
          ...fixedSizing(node, handle),
        };
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
