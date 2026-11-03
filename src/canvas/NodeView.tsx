import { memo, type CSSProperties } from 'react';
import { useEditorState } from '../editor/react';
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
    if (node.textResize === 'auto-width') {
      style.width = 'max-content';
      style.minWidth = 1;
    }
    if (node.textResize !== 'fixed') style.height = 'auto';
  }

  return (
    <div className={`sc-node sc-${node.type}`} data-node-id={id} data-locked={node.locked || undefined} style={style}>
      {node.type === 'text' ? (
        editing ? (
          <TextEditor node={node} />
        ) : (
          node.text
        )
      ) : (
        node.children.map((childId) => <NodeView key={childId} id={childId} />)
      )}
    </div>
  );
});
