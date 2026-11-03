import { useEffect } from 'react';
import { isTypingTarget } from '../canvas/Canvas';
import type { Editor, Tool } from '../editor/editor';
import { CLIPBOARD_FORMAT } from '../model/commands';
import {
  alignSelection,
  copySelectionData,
  deleteSelection,
  duplicateSelection,
  getInternalClipboard,
  groupSelection,
  nudgeSelection,
  parseClipboardText,
  pasteData,
  reorderSelection,
  selectAll,
  selectChildren,
  selectParent,
  toggleLockSelection,
  toggleVisibleSelection,
  ungroupSelection,
  zoomBy,
  zoomTo,
  zoomToFit,
  zoomToSelection,
} from './actions';

const TOOL_KEYS: Record<string, Tool> = {
  v: 'move',
  f: 'frame',
  a: 'frame',
  r: 'rect',
  o: 'ellipse',
  e: 'ellipse',
  t: 'text',
  h: 'hand',
};

/**
 * Global keyboard shortcuts and clipboard events. Ignored while typing in a
 * field or editing text on the canvas.
 */
export function useShortcuts(editor: Editor): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.defaultPrevented) return;
      // A drag in progress owns the document until it ends (Escape cancels it in the canvas).
      if (editor.inGesture) return;
      if ((e.target as Element | null)?.closest?.('.menu')) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const state = editor.getState();

      const run = (fn: () => void) => {
        e.preventDefault();
        fn();
      };

      if (mod) {
        if (key === 'z' && !e.shiftKey) return run(() => editor.undo());
        if ((key === 'z' && e.shiftKey) || key === 'y') return run(() => editor.redo());
        if (key === 'd') return run(() => duplicateSelection(editor));
        if (key === 'a') return run(() => selectAll(editor));
        if (key === 'g') return run(() => (e.shiftKey ? ungroupSelection(editor) : groupSelection(editor)));
        if (e.code === 'BracketRight') return run(() => reorderSelection(editor, e.shiftKey ? 'front' : 'forward'));
        if (e.code === 'BracketLeft') return run(() => reorderSelection(editor, e.shiftKey ? 'back' : 'backward'));
        if (key === 'l' && e.shiftKey) return run(() => toggleLockSelection(editor));
        if (key === 'h' && e.shiftKey) return run(() => toggleVisibleSelection(editor));
        if (key === '=' || key === '+') return run(() => zoomBy(editor, 1));
        if (key === '-' || key === '_') return run(() => zoomBy(editor, -1));
        if (key === '0') return run(() => zoomTo(editor, 1));
        return;
      }

      if (e.altKey) {
        const align = { a: 'left', d: 'right', w: 'top', s: 'bottom', h: 'hcenter', v: 'vcenter' } as const;
        const alignment = align[e.code.replace('Key', '').toLowerCase() as keyof typeof align];
        if (alignment) return run(() => alignSelection(editor, alignment));
        return;
      }

      if (e.shiftKey && e.code === 'Digit0') return run(() => zoomTo(editor, 1));
      if (e.shiftKey && e.code === 'Digit1') return run(() => zoomToFit(editor));
      if (e.shiftKey && e.code === 'Digit2') return run(() => zoomToSelection(editor));

      if (key === 'delete' || key === 'backspace') return run(() => deleteSelection(editor));
      if (key === 'escape') {
        return run(() => {
          if (state.tool !== 'move') editor.setTool('move');
          else if (state.selection.some((id) => state.doc.nodes[id]?.parentId !== state.doc.rootId)) selectParent(editor);
          else editor.select([]);
        });
      }
      if (key === 'enter') {
        return run(() => {
          const only = state.selection.length === 1 ? state.doc.nodes[state.selection[0]] : null;
          if (e.shiftKey) selectParent(editor);
          else if (only?.type === 'text') editor.setEditingText(only.id);
          else selectChildren(editor);
        });
      }
      if (key.startsWith('arrow')) {
        const step = e.shiftKey ? 10 : 1;
        const d = { arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, -step], arrowdown: [0, step] }[key];
        if (d) return run(() => nudgeSelection(editor, d[0], d[1]));
      }
      if (!e.shiftKey && TOOL_KEYS[key]) return run(() => editor.setTool(TOOL_KEYS[key]));
    };

    const onCopy = (e: ClipboardEvent) => {
      if (isTypingTarget(e.target) || hasTextSelection()) return;
      const data = copySelectionData(editor);
      if (!data || !e.clipboardData) return;
      e.preventDefault();
      e.clipboardData.setData('text/plain', JSON.stringify(data));
      if (e.type === 'cut') deleteSelection(editor);
    };

    const onPaste = (e: ClipboardEvent) => {
      if (isTypingTarget(e.target) || editor.inGesture) return;
      const text = e.clipboardData?.getData('text/plain') ?? '';
      const data = text.includes(CLIPBOARD_FORMAT) ? parseClipboardText(text) : getInternalClipboard();
      if (!data) return;
      e.preventDefault();
      pasteData(editor, data);
    };

    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCopy);
    document.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCopy);
      document.removeEventListener('paste', onPaste);
    };
  }, [editor]);
}

function hasTextSelection(): boolean {
  const sel = window.getSelection();
  return !!sel && !sel.isCollapsed && sel.toString().length > 0;
}
