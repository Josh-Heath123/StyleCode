import { fitRect, nextZoomStep, zoomAt, type Camera } from '../editor/camera';
import type { Editor } from '../editor/editor';
import {
  alignOps,
  copyToClipboardData,
  deleteOps,
  distributeOps,
  duplicateOps,
  groupOps,
  isClipboardData,
  moveByOps,
  pasteOps,
  reorderOps,
  ungroupOps,
  type Alignment,
  type ClipboardData,
} from '../model/commands';
import { getAncestors, sortByDocumentOrder, topLevelIds } from '../model/document';
import { unionWorldBounds } from '../model/geometry';
import { isSelectable } from '../model/hit';

/**
 * Editing actions shared by keyboard shortcuts, menus and the context menu,
 * so each behaviour is defined once.
 */

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? '⌘' : 'Ctrl+';
/** Modifier names for prose such as "Ctrl + click". */
export const MOD_KEY = isMac ? '⌘' : 'Ctrl';
export const ALT_KEY = isMac ? '⌥' : 'Alt';
const SHIFT = isMac ? '⇧' : 'Shift+';
const ALT = isMac ? '⌥' : 'Alt+';

export const SHORTCUT_LABELS = {
  undo: `${MOD}Z`,
  redo: isMac ? '⇧⌘Z' : 'Ctrl+Y',
  duplicate: `${MOD}D`,
  copy: `${MOD}C`,
  cut: `${MOD}X`,
  paste: `${MOD}V`,
  delete: 'Del',
  selectAll: `${MOD}A`,
  group: `${MOD}G`,
  ungroup: `${SHIFT}${MOD}G`.replace('Shift+Ctrl+', 'Ctrl+Shift+'),
  forward: `${MOD}]`,
  backward: `${MOD}[`,
  front: isMac ? '⇧⌘]' : 'Ctrl+Shift+]',
  back: isMac ? '⇧⌘[' : 'Ctrl+Shift+[',
  lock: isMac ? '⇧⌘L' : 'Ctrl+Shift+L',
  hide: isMac ? '⇧⌘H' : 'Ctrl+Shift+H',
  zoomIn: `${MOD}+`,
  zoomOut: `${MOD}−`,
  zoom100: `${SHIFT}0`,
  zoomFit: `${SHIFT}1`,
  zoomSelection: `${SHIFT}2`,
  alignLeft: `${ALT}A`,
  alignRight: `${ALT}D`,
  alignTop: `${ALT}W`,
  alignBottom: `${ALT}S`,
  alignHCenter: `${ALT}H`,
  alignVCenter: `${ALT}V`,
} as const;

const selectedIds = (editor: Editor) => {
  const { doc, selection } = editor.getState();
  return topLevelIds(doc, selection).filter((id) => id !== doc.rootId);
};

export const hasSelection = (editor: Editor) => selectedIds(editor).length > 0;

export function deleteSelection(editor: Editor): void {
  const ids = selectedIds(editor);
  if (ids.length === 0) return;
  editor.apply(deleteOps(editor.getState().doc, ids), {
    label: ids.length > 1 ? 'Delete layers' : 'Delete layer',
    selection: [],
  });
}

export function duplicateSelection(editor: Editor): void {
  const ids = selectedIds(editor);
  if (ids.length === 0) return;
  const { ops, newIds } = duplicateOps(editor.getState().doc, ids, { x: 16, y: 16 });
  editor.apply(ops, { label: 'Duplicate', selection: newIds });
}

export function groupSelection(editor: Editor): void {
  const result = groupOps(editor.getState().doc, selectedIds(editor));
  if (result) editor.apply(result.ops, { label: 'Group', selection: [result.groupId] });
}

export function ungroupSelection(editor: Editor): void {
  const result = ungroupOps(editor.getState().doc, selectedIds(editor));
  if (result) editor.apply(result.ops, { label: 'Ungroup', selection: result.childIds });
  else editor.notify('Select a frame or group to ungroup.');
}

export function canUngroup(editor: Editor): boolean {
  const { doc } = editor.getState();
  return selectedIds(editor).some((id) => doc.nodes[id].type === 'frame' && doc.nodes[id].children.length > 0);
}

export function reorderSelection(editor: Editor, direction: 'forward' | 'backward' | 'front' | 'back'): void {
  const labels = { forward: 'Bring forward', backward: 'Send backward', front: 'Bring to front', back: 'Send to back' };
  editor.apply(reorderOps(editor.getState().doc, selectedIds(editor), direction), { label: labels[direction] });
}

export function alignSelection(editor: Editor, alignment: Alignment): void {
  editor.apply(alignOps(editor.getState().doc, selectedIds(editor), alignment), { label: 'Align' });
}

export function distributeSelection(editor: Editor, axis: 'horizontal' | 'vertical'): void {
  editor.apply(distributeOps(editor.getState().doc, selectedIds(editor), axis), { label: 'Distribute' });
}

export function nudgeSelection(editor: Editor, dx: number, dy: number): void {
  const ids = selectedIds(editor).filter((id) => !editor.getState().doc.nodes[id].locked);
  if (ids.length === 0) return;
  editor.apply(moveByOps(editor.getState().doc, ids, { x: dx, y: dy }), {
    label: 'Nudge',
    coalesceKey: `nudge:${ids.join(',')}`,
  });
}

export function toggleLockSelection(editor: Editor): void {
  const { doc } = editor.getState();
  const ids = selectedIds(editor);
  if (ids.length === 0) return;
  const locked = !ids.every((id) => doc.nodes[id].locked);
  editor.apply(
    ids.map((id) => ({ type: 'update', id, props: { locked } })),
    { label: locked ? 'Lock' : 'Unlock', selection: locked ? [] : ids },
  );
}

export function toggleVisibleSelection(editor: Editor): void {
  const { doc } = editor.getState();
  const ids = selectedIds(editor);
  if (ids.length === 0) return;
  const visible = !ids.every((id) => doc.nodes[id].visible);
  editor.apply(
    ids.map((id) => ({ type: 'update', id, props: { visible } })),
    { label: visible ? 'Show' : 'Hide' },
  );
}

/** Selects every selectable sibling of the current selection, or every top-level layer. */
export function selectAll(editor: Editor): void {
  const { doc, selection } = editor.getState();
  const parentId = selection.length ? (doc.nodes[selection[0]]?.parentId ?? doc.rootId) : doc.rootId;
  editor.select(doc.nodes[parentId].children.filter((id) => isSelectable(doc, id)));
}

export function selectParent(editor: Editor): void {
  const { doc, selection } = editor.getState();
  const parents = [
    ...new Set(selection.map((id) => doc.nodes[id]?.parentId).filter((p): p is string => !!p && p !== doc.rootId)),
  ];
  editor.select(parents);
}

export function selectChildren(editor: Editor): void {
  const { doc, selection } = editor.getState();
  const children = selection.flatMap((id) => doc.nodes[id]?.children ?? []).filter((id) => isSelectable(doc, id));
  if (children.length) editor.select(children);
}

// ---------------------------------------------------------------------------
// Clipboard
// ---------------------------------------------------------------------------

let internalClipboard: ClipboardData | null = null;

export function copySelectionData(editor: Editor): ClipboardData | null {
  const data = copyToClipboardData(editor.getState().doc, selectedIds(editor));
  if (data) internalClipboard = data;
  return data;
}

/** Where pasted layers should go: into a single selected frame, otherwise next to the selection. */
function pasteTarget(editor: Editor, data: ClipboardData): string | null {
  const { doc, selection } = editor.getState();
  const copiedIds = new Set(data.items.map((it) => it.nodes[0]?.id));
  if (selection.length === 1) {
    const node = doc.nodes[selection[0]];
    if (node?.type === 'frame' && !copiedIds.has(node.id)) return node.id;
    if (node?.parentId) return node.parentId;
  }
  return null;
}

export function pasteData(editor: Editor, data: ClipboardData): void {
  const { ops, newIds } = pasteOps(editor.getState().doc, data, pasteTarget(editor, data));
  editor.apply(ops, { label: 'Paste', selection: newIds });
}

export function parseClipboardText(text: string): ClipboardData | null {
  try {
    const value = JSON.parse(text);
    return isClipboardData(value) ? value : null;
  } catch {
    return null;
  }
}

/** Copy from a menu: writes to the system clipboard when allowed, always to the in-app clipboard. */
export async function copyFromMenu(editor: Editor, cut = false): Promise<void> {
  const data = copySelectionData(editor);
  if (!data) return;
  try {
    await navigator.clipboard.writeText(JSON.stringify(data));
  } catch {
    // The in-app clipboard still works within this tab.
  }
  if (cut) deleteSelection(editor);
}

export async function pasteFromMenu(editor: Editor): Promise<void> {
  let data: ClipboardData | null = null;
  try {
    data = parseClipboardText(await navigator.clipboard.readText());
  } catch {
    // Reading the system clipboard needs permission; fall back to the in-app clipboard.
  }
  data ??= internalClipboard;
  if (data) pasteData(editor, data);
  else editor.notify('Nothing to paste yet. Copy some layers first.');
}

export function getInternalClipboard(): ClipboardData | null {
  return internalClipboard;
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

function viewportCenter(editor: Editor) {
  return { x: editor.viewport.width / 2, y: editor.viewport.height / 2 };
}

export function zoomBy(editor: Editor, direction: 1 | -1): void {
  const camera = editor.getState().camera;
  editor.setCamera(zoomAt(camera, viewportCenter(editor), nextZoomStep(camera.zoom, direction)));
}

export function zoomTo(editor: Editor, zoom: number): void {
  editor.setCamera(zoomAt(editor.getState().camera, viewportCenter(editor), zoom));
}

/** Camera that shows all layers (or a default view of the origin for an empty page). */
export function fitAllCamera(editor: Editor): Camera {
  const { doc } = editor.getState();
  const visible = doc.nodes[doc.rootId].children.filter((id) => doc.nodes[id].visible);
  const bounds = unionWorldBounds(doc, visible);
  if (!bounds) return { x: editor.viewport.width / 2 - 200, y: editor.viewport.height / 2 - 150, zoom: 1 };
  return fitRect(bounds, editor.viewport, 80, 1);
}

export function zoomToFit(editor: Editor): void {
  editor.setCamera(fitAllCamera(editor));
}

export function zoomToSelection(editor: Editor): void {
  const { doc } = editor.getState();
  const bounds = unionWorldBounds(doc, selectedIds(editor));
  if (!bounds) return zoomToFit(editor);
  editor.setCamera(fitRect(bounds, editor.viewport, 80, 8));
}

/** Ensures every ancestor of the given layers is expanded in the layer tree; returns them. */
export function ancestorsOf(editor: Editor, ids: readonly string[]): string[] {
  const { doc } = editor.getState();
  return [...new Set(ids.flatMap((id) => getAncestors(doc, id)))];
}

export function orderedSelection(editor: Editor): string[] {
  const { doc, selection } = editor.getState();
  return sortByDocumentOrder(doc, selection);
}
