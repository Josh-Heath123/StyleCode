import type { Editor } from '../editor/editor';
import type { MenuEntry } from '../ui/Menu';
import {
  canUngroup,
  copyFromMenu,
  deleteSelection,
  duplicateSelection,
  groupSelection,
  hasSelection,
  pasteFromMenu,
  reorderSelection,
  selectAll,
  SHORTCUT_LABELS as K,
  toggleLockSelection,
  toggleVisibleSelection,
  ungroupSelection,
  zoomToFit,
  zoomToSelection,
} from './actions';

export function canvasMenuEntries(editor: Editor): MenuEntry[] {
  if (!hasSelection(editor)) {
    return [
      { label: 'Paste', shortcut: K.paste, onSelect: () => void pasteFromMenu(editor) },
      { label: 'Select all', shortcut: K.selectAll, onSelect: () => selectAll(editor) },
      { kind: 'separator' },
      { label: 'Zoom to fit', shortcut: K.zoomFit, onSelect: () => zoomToFit(editor) },
    ];
  }
  const { doc, selection } = editor.getState();
  const allLocked = selection.every((id) => doc.nodes[id]?.locked);
  const allHidden = selection.every((id) => !doc.nodes[id]?.visible);
  return [
    { label: 'Copy', shortcut: K.copy, onSelect: () => void copyFromMenu(editor) },
    { label: 'Cut', shortcut: K.cut, onSelect: () => void copyFromMenu(editor, true) },
    { label: 'Paste', shortcut: K.paste, onSelect: () => void pasteFromMenu(editor) },
    { label: 'Duplicate', shortcut: K.duplicate, onSelect: () => duplicateSelection(editor) },
    { kind: 'separator' },
    { label: 'Bring to front', shortcut: K.front, onSelect: () => reorderSelection(editor, 'front') },
    { label: 'Bring forward', shortcut: K.forward, onSelect: () => reorderSelection(editor, 'forward') },
    { label: 'Send backward', shortcut: K.backward, onSelect: () => reorderSelection(editor, 'backward') },
    { label: 'Send to back', shortcut: K.back, onSelect: () => reorderSelection(editor, 'back') },
    { kind: 'separator' },
    { label: 'Group selection', shortcut: K.group, onSelect: () => groupSelection(editor) },
    { label: 'Ungroup', shortcut: K.ungroup, onSelect: () => ungroupSelection(editor), disabled: !canUngroup(editor) },
    { kind: 'separator' },
    { label: allLocked ? 'Unlock' : 'Lock', shortcut: K.lock, onSelect: () => toggleLockSelection(editor) },
    { label: allHidden ? 'Show' : 'Hide', shortcut: K.hide, onSelect: () => toggleVisibleSelection(editor) },
    { label: 'Zoom to selection', shortcut: K.zoomSelection, onSelect: () => zoomToSelection(editor) },
    { kind: 'separator' },
    { label: 'Delete', shortcut: K.delete, onSelect: () => deleteSelection(editor), danger: true },
  ];
}
