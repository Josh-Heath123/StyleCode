import { createContext, useContext, useRef, useSyncExternalStore } from 'react';
import type { Editor, EditorState } from './editor';

export const EditorContext = createContext<Editor | null>(null);

export function useEditor(): Editor {
  const editor = useContext(EditorContext);
  if (!editor) throw new Error('useEditor must be used inside <EditorContext.Provider>');
  return editor;
}

/**
 * Subscribes a component to a slice of editor state. The component only
 * re-renders when the selected value changes according to `isEqual`, which
 * is what keeps the canvas fast: each layer subscribes to its own node.
 */
export function useEditorState<T>(selector: (state: EditorState) => T, isEqual: (a: T, b: T) => boolean = Object.is): T {
  const editor = useEditor();
  const cache = useRef<{ state: EditorState; selector: (state: EditorState) => T; value: T } | null>(null);
  const getSnapshot = () => {
    const state = editor.getState();
    const cached = cache.current;
    if (cached && cached.state === state && cached.selector === selector) return cached.value;
    const value = selector(state);
    if (cached && isEqual(cached.value, value)) {
      cache.current = { state, selector, value: cached.value };
      return cached.value;
    }
    cache.current = { state, selector, value };
    return value;
  };
  return useSyncExternalStore(editor.subscribe, getSnapshot, getSnapshot);
}

export function shallowArrayEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
