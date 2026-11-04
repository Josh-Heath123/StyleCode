import { useEffect, useRef, useState } from 'react';
import { useEditor, useEditorState } from '../editor/react';
import { displayName } from '../panels/LayersPanel';

/**
 * Screen-reader announcements. The regions are always in the page (a live
 * region that appears together with its text is often not read), and only
 * their text changes: what is selected, and the editor's notices.
 */
export function Announcer() {
  const editor = useEditor();
  const selection = useEditorState((s) => s.selection);
  const notice = useEditorState((s) => s.notice);
  const [polite, setPolite] = useState('');
  const first = useRef(true);

  useEffect(() => {
    // Nothing to say about the selection the editor starts with.
    if (first.current) {
      first.current = false;
      return;
    }
    // Wait a moment so a burst of changes (a marquee drag, holding Tab) is read once.
    const timer = setTimeout(() => {
      const { doc } = editor.getState();
      const nodes = selection.map((id) => doc.nodes[id]).filter((n) => !!n);
      if (nodes.length === 0) setPolite('Nothing selected');
      else if (nodes.length === 1) {
        const n = nodes[0];
        setPolite(`${displayName(n)}, ${n.type === 'frame' && n.parentId === doc.rootId ? 'page frame' : n.type}, selected`);
      } else setPolite(`${nodes.length} layers selected`);
    }, 150);
    return () => clearTimeout(timer);
  }, [editor, selection]);

  return (
    <>
      <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {notice && notice.tone !== 'error' ? notice.text : polite}
      </div>
      <div className="visually-hidden" role="alert" aria-live="assertive" aria-atomic="true">
        {notice?.tone === 'error' ? notice.text : ''}
      </div>
    </>
  );
}
