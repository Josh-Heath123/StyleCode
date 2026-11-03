import { useLayoutEffect, useRef } from 'react';
import { useEditor } from '../editor/react';
import type { DesignNode } from '../model/types';

/** In-place text editing for a text layer. Commits on blur, Escape or Ctrl/⌘+Enter. */
export function TextEditor({ node }: { node: DesignNode }) {
  const editor = useEditor();
  const ref = useRef<HTMLDivElement>(null);
  const done = useRef(false);

  useLayoutEffect(() => {
    const el = ref.current!;
    el.textContent = node.text;
    el.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    // Only the initial text is set here; afterwards the DOM owns the content until commit.
  }, []);

  const commit = () => {
    if (done.current) return;
    done.current = true;
    const el = ref.current;
    const text = (el?.innerText ?? '').replace(/\r/g, '').replace(/\n$/, '');
    const pending = editor.pendingText.get(node.id);
    editor.pendingText.delete(node.id);
    editor.setEditingText(null);

    if (!editor.getState().doc.nodes[node.id]) return;
    if (text.trim() === '') {
      if (pending === undefined || !editor.discardTransaction(pending)) {
        editor.apply([{ type: 'delete', id: node.id }], { label: 'Delete text', selection: [] });
      }
      return;
    }
    if (text !== node.text) {
      editor.apply([{ type: 'update', id: node.id, props: { text } }], {
        label: pending !== undefined ? 'Add text' : 'Edit text',
        selection: [node.id],
        mergeInto: pending,
      });
    } else {
      editor.select([node.id]);
    }
  };

  return (
    <div
      ref={ref}
      className="sc-text-editor"
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      spellCheck={false}
      onBlur={commit}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
          e.preventDefault();
          commit();
        }
      }}
    />
  );
}
