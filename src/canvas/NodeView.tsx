import { memo, type CSSProperties } from 'react';
import { useEditorState } from '../editor/react';
import type { DesignNode } from '../model/types';
import { useAssetUrl } from '../persistence/assets';
import { nodeDeclarations } from '../render/css';
import { TextEditor } from './TextEditor';

/**
 * Renders one layer as a real DOM element. Each NodeView subscribes only to
 * its own node, so editing one layer re-renders one component.
 */
export const NodeView = memo(function NodeView({ id }: { id: string }) {
  const node = useEditorState((s) => s.doc.nodes[id]);
  const editing = useEditorState((s) => s.editingTextId === id);
  if (!node || !node.visible) return null;

  const style = nodeDeclarations(node) as CSSProperties;
  if (editing && node.type === 'text') {
    // Let the box follow the text while typing; the real size is measured on commit.
    if (node.textResize === 'auto-width' && node.widthMode !== 'fill') {
      style.width = 'max-content';
      style.minWidth = 1;
    }
    if (node.textResize !== 'fixed') style.height = 'auto';
  }

  let content: React.ReactNode;
  if (node.type === 'text') content = editing ? <TextEditor node={node} /> : node.text;
  else if (node.type === 'image') content = <ImageContent node={node} />;
  else content = node.children.map((childId) => <NodeView key={childId} id={childId} />);

  return (
    <div className={`sc-node sc-${node.type}`} data-node-id={id} data-locked={node.locked || undefined} style={style}>
      {content}
    </div>
  );
});

/** The picture inside an image layer, or a placeholder when it has none (or it is missing on this device). */
function ImageContent({ node }: { node: DesignNode }) {
  const { url, missing } = useAssetUrl(node.src);
  if (url) return <img className="sc-image" src={url} alt="" draggable={false} style={{ objectFit: node.fit }} />;
  if (!missing) return null;
  return (
    <div className="sc-image-placeholder" aria-hidden="true">
      <svg
        viewBox="0 0 24 24"
        width="28"
        height="28"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
        <circle cx="9" cy="9" r="2" />
        <path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21" />
      </svg>
    </div>
  );
}
