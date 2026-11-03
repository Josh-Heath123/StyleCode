import { useMemo, useState, type CSSProperties } from 'react';
import { BLOCKS, type BlockDefinition, type BlockTheme } from '../app/blocks';
import { insertAtClickTarget, insertImagesFromPicker } from '../app/insert';
import { SHORTCUT_LABELS as K } from '../app/actions';
import { normalizeDocument } from '../canvas/normalize';
import { useEditor } from '../editor/react';
import { createDocument } from '../model/document';
import { applyOps } from '../model/ops';
import type { DesignDocument } from '../model/types';
import { nodeDeclarations } from '../render/css';
import { Icon } from '../ui/Icon';
import { Segmented } from './controls';

export const BLOCK_MIME = 'application/x-stylecode-block';

/** Lays out a block in a scratch document, the same way the canvas will, for its preview. */
function preview(block: BlockDefinition, theme: BlockTheme): { doc: DesignDocument; rootId: string } {
  const base = createDocument();
  const nodes = block.build(theme);
  const ops = [{ type: 'create' as const, parentId: base.rootId, index: 0, nodes }];
  let doc = applyOps(base, ops).doc;
  const extra = normalizeDocument(doc, new Set(nodes.map((n) => n.id)), base);
  if (extra.length) doc = applyOps(doc, extra).doc;
  return { doc, rootId: nodes[0].id };
}

function StaticNode({ doc, id, root }: { doc: DesignDocument; id: string; root?: boolean }) {
  const node = doc.nodes[id];
  const style = nodeDeclarations(node) as CSSProperties;
  if (root) {
    style.left = 0;
    style.top = 0;
  }
  return (
    <div className={`sc-node sc-${node.type}`} style={style}>
      {node.type === 'text' ? (
        node.text
      ) : node.type === 'image' ? (
        <div className="sc-image-placeholder" />
      ) : (
        node.children.map((c) => <StaticNode key={c} doc={doc} id={c} />)
      )}
    </div>
  );
}

const PREVIEW_W = 196;
const PREVIEW_H = 84;

function BlockCard({ block, theme }: { block: BlockDefinition; theme: BlockTheme }) {
  const editor = useEditor();
  const { doc, rootId } = useMemo(() => preview(block, theme), [block, theme]);
  const root = doc.nodes[rootId];
  const scale = Math.min(1, (PREVIEW_W - 16) / root.width, (PREVIEW_H - 16) / root.height);

  return (
    <button
      type="button"
      className="block-card"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(BLOCK_MIME, JSON.stringify({ id: block.id, theme }));
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={() => insertAtClickTarget(editor, block.build(theme), `Add ${block.name.toLowerCase()}`)}
      aria-label={`Insert ${block.name}`}
    >
      <span className="block-preview" data-theme={theme} aria-hidden="true">
        <span
          className="block-preview-inner"
          style={{ width: root.width, height: root.height, transform: `translate(-50%, -50%) scale(${scale})` }}
        >
          <StaticNode doc={doc} id={rootId} root />
        </span>
      </span>
      <span className="block-text">
        <span className="block-name">{block.name}</span>
        <span className="block-description">{block.description}</span>
      </span>
    </button>
  );
}

/** Left sidebar tab: ready-made blocks and images to add to the design. */
export function InsertPanel() {
  const editor = useEditor();
  const [theme, setTheme] = useState<BlockTheme>('light');
  return (
    <div className="panel-scroll insert-panel">
      <section className="section" aria-label="Images">
        <button type="button" className="button wide" onClick={() => void insertImagesFromPicker(editor)}>
          <Icon name="image" size={14} /> Add image… <kbd>{K.insertImage}</kbd>
        </button>
        <p className="panel-hint">You can also drop or paste image files onto the canvas.</p>
      </section>
      <section className="section" aria-label="Blocks">
        <div className="section-head">
          Blocks
          <div style={{ width: 120 }}>
            <Segmented
              name="Block colours"
              value={theme}
              options={[
                { value: 'light', icon: 'sun', label: 'Light blocks' },
                { value: 'dark', icon: 'moon', label: 'Dark blocks' },
              ]}
              onChange={setTheme}
            />
          </div>
        </div>
        <p className="panel-hint">Click to add to the selected frame, or drag onto the canvas.</p>
        <div className="block-list">
          {BLOCKS.map((block) => (
            <BlockCard key={block.id} block={block} theme={theme} />
          ))}
        </div>
      </section>
    </div>
  );
}
