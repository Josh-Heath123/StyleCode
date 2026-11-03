import { useEffect } from 'react';
import { useEditor, useEditorState } from '../editor/react';

/** Brief, non-blocking messages: rejected edits, save problems, file results. */
export function Notice() {
  const editor = useEditor();
  const notice = useEditorState((s) => s.notice);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => editor.clearNotice(notice.id), notice.tone === 'error' ? 6000 : 3000);
    return () => clearTimeout(timer);
  }, [editor, notice]);
  if (!notice) return null;
  return (
    <div className="notice glass" role={notice.tone === 'error' ? 'alert' : 'status'} data-tone={notice.tone}>
      {notice.text}
    </div>
  );
}
