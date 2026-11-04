import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { canvasMenuEntries } from '../app/contextMenu';
import { selectSibling } from '../app/actions';
import { clampZoom, screenToWorld, zoomAt } from '../editor/camera';
import { useEditor, useEditorState } from '../editor/react';
import { isSelectable } from '../model/hit';
import { findBlock, type BlockTheme } from '../app/blocks';
import { insertAtPoint, insertImageFiles } from '../app/insert';
import { BLOCK_MIME } from '../panels/InsertPanel';
import type { DesignDocument } from '../model/types';
import { Menu, type MenuEntry } from '../ui/Menu';
import {
  connectGesture,
  drawGesture,
  marqueeGesture,
  noteGesture,
  moveGesture,
  panGesture,
  resizeGesture,
  rotateGesture,
  type DrawTool,
  type Gesture,
  type GestureContext,
  type HandleName,
} from './gestures';
import { NodeView } from './NodeView';
import { Overlay } from './Overlay';

const DRAW_TOOLS = new Set(['frame', 'rect', 'ellipse', 'text']);

function nodeIdFromTarget(target: EventTarget | null): string | null {
  const el = (target as Element | null)?.closest?.('[data-node-id]');
  return el?.getAttribute('data-node-id') ?? null;
}

/**
 * Decides which layer a click selects. The deepest layer under the pointer
 * wins, except that the background of a top-level frame with content acts
 * like empty canvas (so you can marquee-select inside it); select such a
 * frame by its label instead. Ctrl/⌘ always picks the deepest layer.
 */
function resolveTarget(doc: DesignDocument, hitId: string | null, deep: boolean): string | null {
  if (!hitId || !doc.nodes[hitId] || !isSelectable(doc, hitId)) return null;
  if (deep) return hitId;
  const node = doc.nodes[hitId];
  if (node.type === 'frame' && node.parentId === doc.rootId && node.children.length > 0) return null;
  return hitId;
}

export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
}

const CONTROL =
  'button, a[href], summary, [role="button"], [role="menuitem"], [role="tab"], [role="radio"], [role="checkbox"], [role="switch"], [role="option"]';

/**
 * A button or similar control reached with the keyboard. Enter and Space (and
 * arrows, for tabs and radio groups) belong to it, not to the editor's
 * shortcuts. A control focused by a mouse click doesn't count, so pressing
 * Space to pan after clicking a toolbar button doesn't press it again.
 */
export function isKeyboardFocusedControl(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement) || !target.matches(CONTROL)) return false;
  try {
    return target.matches(':focus-visible');
  } catch {
    return true;
  }
}

/** When Tab was last pressed: focus that arrives on the canvas right after it came from the keyboard. */
let lastTabAt = -Infinity;
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => e.key === 'Tab' && (lastTabAt = performance.now()), true);
}

export function Canvas() {
  const editor = useEditor();
  const viewportRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<{ gesture: Gesture; pointerId: number } | null>(null);
  const spaceDown = useRef(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [gestureCursor, setGestureCursor] = useState<string | null>(null);
  // The focus ring shows only when the canvas was reached with Tab, not after a click and a shortcut.
  const [tabbedIn, setTabbedIn] = useState(false);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; entries: MenuEntry[] } | null>(null);

  const camera = useEditorState((s) => s.camera);
  // While the view is moving, the layers are drawn once and slid around by the compositor
  // instead of being repainted every frame; once it stops they are redrawn sharp at the new zoom.
  const contentRef = useRef<HTMLDivElement>(null);
  const settled = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstCamera = useRef(true);
  useEffect(() => {
    if (firstCamera.current) {
      firstCamera.current = false;
      return;
    }
    contentRef.current?.classList.add('is-moving');
    if (settled.current) clearTimeout(settled.current);
    settled.current = setTimeout(() => contentRef.current?.classList.remove('is-moving'), 160);
  }, [camera]);
  useEffect(() => () => void (settled.current && clearTimeout(settled.current)), []);
  const tool = useEditorState((s) => s.tool);
  const rootId = useEditorState((s) => s.doc.rootId);
  const rootChildren = useEditorState((s) => s.doc.nodes[s.doc.rootId].children);
  const pageFill = useEditorState((s) => s.doc.nodes[s.doc.rootId].fill);

  const ctx = useRef<GestureContext>({
    editor,
    toWorld: (clientX, clientY) => {
      const rect = viewportRef.current!.getBoundingClientRect();
      return screenToWorld(editor.getState().camera, { x: clientX - rect.left, y: clientY - rect.top });
    },
  }).current;

  // Keep the editor informed of the viewport size.
  useLayoutEffect(() => {
    const el = viewportRef.current!;
    const update = () => {
      const r = el.getBoundingClientRect();
      editor.viewport = { width: r.width, height: r.height };
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [editor]);

  // Wheel: pinch or Ctrl/⌘ + wheel zooms at the pointer, plain wheel pans.
  useEffect(() => {
    const el = viewportRef.current!;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as Element).closest?.('.menu')) return;
      e.preventDefault();
      const cam = editor.getState().camera;
      const rect = el.getBoundingClientRect();
      const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? rect.height : 1;
      if (e.ctrlKey || e.metaKey) {
        const delta = Math.max(-60, Math.min(60, e.deltaY * scale));
        const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        editor.setCamera(zoomAt(cam, point, cam.zoom * Math.exp(-delta * 0.006)));
      } else {
        let dx = e.deltaX * scale;
        let dy = e.deltaY * scale;
        if (e.shiftKey && dx === 0) [dx, dy] = [dy, 0];
        editor.setCamera({ ...cam, x: cam.x - dx, y: cam.y - dy });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [editor]);

  // Hold Space to pan.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || isTypingTarget(e.target) || isKeyboardFocusedControl(e.target) || e.repeat) return;
      e.preventDefault();
      spaceDown.current = true;
      setSpaceHeld(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      spaceDown.current = false;
      setSpaceHeld(false);
    };
    const blur = () => {
      spaceDown.current = false;
      setSpaceHeld(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  const endGesture = useCallback((cancel: boolean, e?: PointerEvent) => {
    const active = gestureRef.current;
    if (!active) return;
    gestureRef.current = null;
    setGestureCursor(null);
    if (cancel) active.gesture.cancel();
    else if (e) active.gesture.up(e);
    const el = viewportRef.current;
    if (el?.hasPointerCapture(active.pointerId)) el.releasePointerCapture(active.pointerId);
  }, []);

  // Escape cancels an in-progress gesture.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && gestureRef.current) {
        e.stopImmediatePropagation();
        endGesture(true);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [endGesture]);

  // Two-finger pinch and pan on touch screens.
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; world: { x: number; y: number }; zoom: number } | null>(null);

  const touchMidpoint = () => {
    const [a, b] = [...touches.current.values()];
    const rect = viewportRef.current!.getBoundingClientRect();
    return {
      mid: { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top },
      distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
    };
  };

  const trackTouch = (e: React.PointerEvent): boolean => {
    if (e.pointerType !== 'touch') return false;
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.current.size === 2) {
      // A second finger turns whatever the first one started into a pinch.
      endGesture(true);
      const { mid, distance } = touchMidpoint();
      const cam = editor.getState().camera;
      pinch.current = { distance, zoom: cam.zoom, world: screenToWorld(cam, mid) };
      viewportRef.current!.setPointerCapture(e.pointerId);
      return true;
    }
    return touches.current.size > 2;
  };

  const releaseTouch = (e: React.PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    touches.current.delete(e.pointerId);
    if (touches.current.size < 2) pinch.current = null;
  };

  const start = (gesture: Gesture, e: React.PointerEvent) => {
    gestureRef.current = { gesture, pointerId: e.pointerId };
    viewportRef.current!.setPointerCapture(e.pointerId);
    setGestureCursor(gesture.cursor ?? null);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (trackTouch(e) || pinch.current) return;
    if (gestureRef.current) return;
    const target = e.target as Element;
    if (target.closest('.menu')) return;

    // Finish whatever is being typed (a panel field, or text on the canvas) before the
    // selection changes, so the edit lands on the layer it was meant for.
    if (isTypingTarget(document.activeElement)) (document.activeElement as HTMLElement).blur();
    const state = editor.getState();
    const native = e.nativeEvent;

    if (e.button === 1 || (e.button === 0 && (spaceDown.current || state.tool === 'hand'))) {
      e.preventDefault();
      start(panGesture(ctx, native), e);
      return;
    }
    if (e.button !== 0) return;

    const handle = target.closest('[data-handle]')?.getAttribute('data-handle') as HandleName | null;
    if (handle) {
      const cursor = target.closest('[data-handle]')?.getAttribute('data-cursor') ?? 'default';
      start(resizeGesture(ctx, state.selection, handle, cursor), e);
      return;
    }
    if (target.closest('[data-rotate]') && state.selection.length === 1) {
      start(rotateGesture(ctx, native, state.selection[0], (target as HTMLElement).style.cursor), e);
      return;
    }
    const connector = target.closest('[data-note-connector]')?.getAttribute('data-note-connector');
    if (connector) {
      start(connectGesture(ctx, connector, ctx.toWorld(e.clientX, e.clientY)), e);
      return;
    }

    if (DRAW_TOOLS.has(state.tool)) {
      start(drawGesture(ctx, native, state.tool as DrawTool), e);
      return;
    }
    if (state.tool === 'note') {
      // Clicking a layer pins the note to it.
      const hit = resolveTarget(state.doc, nodeIdFromTarget(target), true);
      start(noteGesture(ctx, native, hit && state.doc.nodes[hit].type !== 'note' ? hit : null), e);
      return;
    }

    const labelId = target.closest('[data-frame-label]')?.getAttribute('data-frame-label');
    const hitId = labelId ?? nodeIdFromTarget(target);
    const deep = e.ctrlKey || e.metaKey;
    const picked = labelId && isSelectable(state.doc, labelId) ? labelId : resolveTarget(state.doc, hitId, deep);

    if (picked) {
      const selection = state.selection;
      let selectOnClick: string | undefined;
      if (e.shiftKey) {
        if (selection.includes(picked)) {
          editor.select(selection.filter((id) => id !== picked));
          return;
        }
        editor.select([...selection, picked]);
      } else if (!selection.includes(picked)) {
        editor.select([picked]);
      } else if (selection.length > 1) {
        selectOnClick = picked;
      }
      start(moveGesture(ctx, native, editor.getState().selection, { selectOnClick }), e);
      return;
    }

    // Empty canvas, or the background of a top-level frame: marquee within that scope.
    const scope =
      hitId && state.doc.nodes[hitId]?.parentId === state.doc.rootId && state.doc.nodes[hitId].type === 'frame'
        ? hitId
        : state.doc.rootId;
    start(marqueeGesture(ctx, native, scope, e.shiftKey), e);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch' && touches.current.has(e.pointerId)) {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const p = pinch.current;
      if (p && touches.current.size === 2) {
        const { mid, distance } = touchMidpoint();
        const zoom = clampZoom(p.zoom * (distance / p.distance));
        editor.setCamera({ zoom, x: mid.x - p.world.x * zoom, y: mid.y - p.world.y * zoom });
        return;
      }
    }
    const active = gestureRef.current;
    if (active) {
      if (active.pointerId === e.pointerId) active.gesture.move(e.nativeEvent);
      return;
    }
    const state = editor.getState();
    if (state.tool !== 'move' || spaceDown.current) return editor.setHover(null);
    const target = e.target as Element;
    const labelId = target.closest('[data-frame-label]')?.getAttribute('data-frame-label');
    if (labelId) return editor.setHover(labelId);
    if (target.closest('[data-handle],[data-rotate]')) return;
    editor.setHover(resolveTarget(state.doc, nodeIdFromTarget(target), e.ctrlKey || e.metaKey));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    releaseTouch(e);
    if (gestureRef.current?.pointerId === e.pointerId) endGesture(false, e.nativeEvent);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const state = editor.getState();
    if (state.tool !== 'move') return;
    // Pointer capture retargets click events to the viewport, so hit-test the point instead,
    // looking through selection handles that may cover a small text layer.
    const hit = document.elementsFromPoint(e.clientX, e.clientY).find((el) => el.closest('[data-node-id]'));
    const id = nodeIdFromTarget(hit ?? null);
    const node = id ? state.doc.nodes[id] : null;
    if ((node?.type === 'text' || node?.type === 'note') && isSelectable(state.doc, node.id)) {
      editor.select([node.id]);
      editor.setEditingText(node.id);
    }
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (gestureRef.current) return;
    const state = editor.getState();
    const id = resolveTarget(state.doc, nodeIdFromTarget(e.target), true);
    if (id && !state.selection.includes(id)) editor.select([id]);
    if (!id && state.selection.length && !(e.target as Element).closest('[data-handle],[data-rotate]')) editor.select([]);
    setMenu({ at: { x: e.clientX, y: e.clientY }, entries: canvasMenuEntries(editor) });
  };

  const gridSize = 24 * camera.zoom;
  const cursor =
    gestureCursor ?? (spaceHeld || tool === 'hand' ? 'grab' : DRAW_TOOLS.has(tool) || tool === 'note' ? 'crosshair' : 'default');

  return (
    <div
      ref={viewportRef}
      className={`canvas${tabbedIn ? ' is-tabbed-in' : ''}`}
      style={{ background: pageFill ?? undefined, cursor }}
      onFocus={(e) => e.target === e.currentTarget && setTabbedIn(performance.now() - lastTabAt < 500)}
      onBlur={(e) => e.target === e.currentTarget && setTabbedIn(false)}
      data-tool={tool}
      onPointerDown={(e) => {
        if (tabbedIn) setTabbedIn(false);
        onPointerDown(e);
      }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={(e) => {
        releaseTouch(e);
        endGesture(true);
      }}
      onLostPointerCapture={(e) => {
        if (gestureRef.current?.pointerId === e.pointerId) endGesture(false, e.nativeEvent);
      }}
      onPointerLeave={() => !gestureRef.current && editor.setHover(null)}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onDragOver={(e) => {
        const types = e.dataTransfer.types;
        if (types.includes('Files') || types.includes(BLOCK_MIME)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDrop={(e) => {
        const at = ctx.toWorld(e.clientX, e.clientY);
        const block = e.dataTransfer.getData(BLOCK_MIME);
        if (block) {
          e.preventDefault();
          const { id, theme } = JSON.parse(block) as { id: string; theme: BlockTheme };
          const def = findBlock(id);
          if (def) insertAtPoint(editor, def.build(theme), at, `Add ${def.name.toLowerCase()}`);
          return;
        }
        const files = [...e.dataTransfer.files];
        if (files.length) {
          e.preventDefault();
          void insertImageFiles(editor, files, at);
        }
      }}
      aria-label="Design canvas"
      aria-roledescription="design canvas"
      aria-describedby="canvas-keys"
      role="application"
      tabIndex={0}
      // Where focus goes when a dialog closes and whatever opened it is gone.
      data-focus-home
      onKeyDown={(e) => {
        // Tab walks through the layers beside the selected one; at either end it leaves the canvas.
        if (e.key !== 'Tab' || e.target !== e.currentTarget || e.ctrlKey || e.metaKey || e.altKey) return;
        if (editor.inGesture || editor.getState().editingTextId) return;
        if (selectSibling(editor, e.shiftKey)) e.preventDefault();
      }}
    >
      <p id="canvas-keys" className="visually-hidden">
        Tab and Shift+Tab move between layers. Enter goes into a frame, Escape goes back out. Arrow keys move the selected layers.
        Press question mark for every shortcut.
      </p>
      {gridSize >= 8 && (
        <div
          className="canvas-grid"
          style={{ backgroundSize: `${gridSize}px ${gridSize}px`, backgroundPosition: `${camera.x}px ${camera.y}px` }}
        />
      )}
      <div
        ref={contentRef}
        className="canvas-content"
        style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}
        data-root-id={rootId}
      >
        {rootChildren.map((id) => (
          <NodeView key={id} id={id} />
        ))}
      </div>
      <Overlay />
      <EmptyHint />
      {menu && <Menu label="Canvas actions" entries={menu.entries} at={menu.at} onClose={() => setMenu(null)} />}
    </div>
  );
}

/** A quiet first-run hint, shown only while the page has no layers drawn inside frames. */
function EmptyHint() {
  const empty = useEditorState((s) => {
    const root = s.doc.nodes[s.doc.rootId];
    return root.children.every((id) => s.doc.nodes[id].type === 'frame' && s.doc.nodes[id].children.length === 0);
  });
  const tool = useEditorState((s) => s.tool);
  if (!empty || tool !== 'move') return null;
  return (
    <div className="empty-hint" role="note">
      Draw your interface: press <kbd>R</kbd> for a rectangle, <kbd>T</kbd> for text, <kbd>F</kbd> for a frame.
    </div>
  );
}
