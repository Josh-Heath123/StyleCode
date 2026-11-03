import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '../editor/editor';
import { shallowArrayEqual, useEditor, useEditorState } from '../editor/react';
import { reparentKeepingPosition } from '../model/commands';
import { getAncestors, isAncestorOf, sortByDocumentOrder, topLevelIds } from '../model/document';
import { OpBuilder } from '../model/ops';
import type { DesignDocument, DesignNode } from '../model/types';
import { Icon } from '../ui/Icon';
import { TYPE_ICONS } from './PropertiesPanel';

const ROW_HEIGHT = 28;
const INDENT = 14;

interface FlatRow {
  id: string;
  depth: number;
}

/** Rows in display order: front-most layers first, children under their parent. */
function flatten(doc: DesignDocument, expanded: ReadonlySet<string>): FlatRow[] {
  const rows: FlatRow[] = [];
  const visit = (id: string, depth: number) => {
    const node = doc.nodes[id];
    for (let i = node.children.length - 1; i >= 0; i--) {
      const childId = node.children[i];
      rows.push({ id: childId, depth });
      if (expanded.has(childId) && doc.nodes[childId].children.length) visit(childId, depth + 1);
    }
  };
  visit(doc.rootId, 0);
  return rows;
}

/** Text layers that still have their default name are shown by their content. */
export function displayName(node: DesignNode): string {
  if (node.type === 'text' && node.name === 'Text' && node.text.trim()) return node.text.trim().split('\n')[0].slice(0, 60);
  return node.name || 'Untitled';
}

type Drop = { kind: 'inside'; targetId: string } | { kind: 'line'; parentId: string; index: number; y: number; depth: number };

export function LayersPanel() {
  const editor = useEditor();
  // The tree's shape: one children array per container. Property edits keep these
  // arrays, so rows are only rebuilt when layers are added, removed or reordered.
  const structure = useEditorState((s) => {
    const shape: (readonly string[])[] = [];
    const walk = (id: string) => {
      const n = s.doc.nodes[id];
      if (n.children.length === 0) return;
      shape.push(n.children);
      n.children.forEach(walk);
    };
    walk(s.doc.rootId);
    return shape;
  }, shallowArrayEqual);
  const selection = useEditorState((s) => s.selection);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [drop, setDrop] = useState<Drop | null>(null);
  const anchor = useRef<string | null>(null);
  // A drag ends with a click on whatever row is under the pointer; ignore that one click.
  const suppressClick = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);

  // Top-level frames start expanded; selected layers' ancestors are revealed.
  useEffect(() => {
    const { doc } = editor.getState();
    setExpanded((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const id of doc.nodes[doc.rootId].children) {
        if (doc.nodes[id].type === 'frame' && !prev.has(`seen:${id}`)) {
          next.add(id);
          next.add(`seen:${id}`);
          changed = true;
        }
      }
      for (const id of selection) {
        for (const a of getAncestors(doc, id)) {
          if (!next.has(a)) {
            next.add(a);
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });
  }, [editor, selection, structure]);

  // `structure` changes whenever the tree's shape does, which is when rows must be rebuilt.
  const rows = useMemo(() => flatten(editor.getState().doc, expanded), [editor, expanded, structure]);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  // Rows inside a selected layer get a lighter highlight.
  const insideSelection = useMemo(() => {
    const { doc } = editor.getState();
    const set = new Set<string>();
    const selected = new Set(selection);
    for (const row of rows) {
      if (getAncestors(doc, row.id).some((a) => selected.has(a))) set.add(row.id);
    }
    return set;
  }, [editor, rows, selection]);

  // Handlers are created once and read the latest rows through a ref, so memoised
  // rows do not re-render just because the list did.
  const handlers = useMemo(() => {
    const toggle = (id: string) =>
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });

    const onRowClick = (e: React.MouseEvent, id: string) => {
      const rows = rowsRef.current;
      if (suppressClick.current) return;
      const { selection: current } = editor.getState();
      if (e.shiftKey && anchor.current) {
        const a = rows.findIndex((r) => r.id === anchor.current);
        const b = rows.findIndex((r) => r.id === id);
        if (a >= 0 && b >= 0) {
          const [from, to] = a < b ? [a, b] : [b, a];
          editor.select(rows.slice(from, to + 1).map((r) => r.id));
          return;
        }
      }
      if (e.ctrlKey || e.metaKey) {
        editor.select(current.includes(id) ? current.filter((s) => s !== id) : [...current, id]);
      } else {
        editor.select([id]);
      }
      anchor.current = id;
    };

    // ---- Drag to reorder / re-parent -------------------------------------------------
    const computeDrop = (clientY: number, dragged: readonly string[]): Drop | null => {
      const rows = rowsRef.current;
      const list = listRef.current;
      if (!list || rows.length === 0) return null;
      const { doc } = editor.getState();
      const top = list.getBoundingClientRect().top + 6; // matches .layers top padding
      const pos = clientY - top;
      const i = Math.max(0, Math.min(rows.length - 1, Math.floor(pos / ROW_HEIGHT)));
      const row = rows[i];
      const node = doc.nodes[row.id];
      const within = pos / ROW_HEIGHT - i; // 0..1 inside the row
      const invalid = (parentId: string) => dragged.some((d) => d === parentId || isAncestorOf(doc, d, parentId));

      if (node.type === 'frame' && within > 0.25 && within < 0.75 && !invalid(row.id)) {
        return { kind: 'inside', targetId: row.id };
      }
      const parentId = node.parentId!;
      if (invalid(parentId)) return null;
      const siblings = doc.nodes[parentId].children;
      const idx = siblings.indexOf(row.id);
      // Rows are listed front-to-back, so "above" a row means in front of it.
      if (pos < 0 || within <= 0.5) return { kind: 'line', parentId, index: idx + 1, y: i * ROW_HEIGHT + 6, depth: row.depth };
      return { kind: 'line', parentId, index: idx, y: (i + 1) * ROW_HEIGHT + 6, depth: row.depth };
    };

    const applyDrop = (target: Drop, dragged: readonly string[]) => {
      const { doc } = editor.getState();
      const ids = sortByDocumentOrder(doc, topLevelIds(doc, dragged));
      const builder = new OpBuilder(doc);
      const parentId = target.kind === 'inside' ? target.targetId : target.parentId;
      // Insert relative to a sibling that is not being moved, so indexes stay meaningful.
      const parentChildren = doc.nodes[parentId].children;
      const anchorId = target.kind === 'line' ? (parentChildren.slice(target.index).find((c) => !ids.includes(c)) ?? null) : null;
      for (const id of ids) {
        const current = builder.doc.nodes[parentId].children.filter((c) => c !== id);
        const index = anchorId ? current.indexOf(anchorId) : current.length;
        if (builder.doc.nodes[id].parentId === parentId) builder.push({ type: 'move', id, parentId, index });
        else reparentKeepingPosition(builder, id, parentId, index);
      }
      if (builder.ops.length)
        editor.apply(builder.ops, { label: target.kind === 'inside' ? 'Move into frame' : 'Reorder', selection: ids });
    };

    const onRowPointerDown = (e: React.PointerEvent, id: string) => {
      if (e.button !== 0 || (e.target as Element).closest('button, input')) return;
      const startY = e.clientY;
      const el = e.currentTarget as HTMLElement;
      el.setPointerCapture(e.pointerId);
      let dragging = false;
      let dragged: string[] = [];
      let current: Drop | null = null;
      const move = (ev: PointerEvent) => {
        if (!dragging) {
          if (Math.abs(ev.clientY - startY) < 4) return;
          dragging = true;
          const sel = editor.getState().selection;
          dragged = sel.includes(id) ? [...sel] : [id];
          if (!sel.includes(id)) editor.select([id]);
        }
        current = computeDrop(ev.clientY, dragged);
        setDrop(current);
      };
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', cancel);
        setDrop(null);
        if (dragging) {
          suppressClick.current = true;
          setTimeout(() => (suppressClick.current = false), 0);
        }
        if (dragging && current) applyDrop(current, dragged);
      };
      const cancel = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', cancel);
        setDrop(null);
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', cancel);
    };

    return { toggle, onRowClick, onRowPointerDown };
  }, [editor]);

  return (
    <>
      <div className="panel-title">Layers</div>
      <div className="panel-scroll">
        {rows.length === 0 ? (
          <p className="layers-empty">Nothing on the page yet. Draw a frame with F or pick a size on the right.</p>
        ) : (
          <div className="layers" ref={listRef} role="tree" aria-label="Layers" aria-multiselectable="true">
            {rows.map((row) => (
              <LayerRow
                key={row.id}
                id={row.id}
                depth={row.depth}
                expanded={expanded.has(row.id)}
                insideSelection={insideSelection.has(row.id)}
                dropInside={drop?.kind === 'inside' && drop.targetId === row.id}
                onToggle={handlers.toggle}
                onClick={handlers.onRowClick}
                onPointerDown={handlers.onRowPointerDown}
                editor={editor}
              />
            ))}
            {drop?.kind === 'line' && <div className="layer-drop-line" style={{ top: drop.y, left: 8 + drop.depth * INDENT }} />}
          </div>
        )}
      </div>
    </>
  );
}

interface LayerRowProps {
  id: string;
  depth: number;
  expanded: boolean;
  insideSelection: boolean;
  dropInside: boolean;
  editor: Editor;
  onToggle: (id: string) => void;
  onClick: (e: React.MouseEvent, id: string) => void;
  onPointerDown: (e: React.PointerEvent, id: string) => void;
}

const LayerRow = memo(function LayerRow({
  id,
  depth,
  expanded,
  insideSelection,
  dropInside,
  editor,
  onToggle,
  onClick,
  onPointerDown,
}: LayerRowProps) {
  const node = useEditorState((s) => s.doc.nodes[id]);
  const selected = useEditorState((s) => s.selection.includes(id));
  const parentSelected = insideSelection && !selected;
  const [renaming, setRenaming] = useState(false);
  if (!node) return null;

  const hasChildren = node.children.length > 0;
  const toggleProp = (key: 'visible' | 'locked') => {
    const value = !node[key];
    const label = key === 'visible' ? (value ? 'Show' : 'Hide') : value ? 'Lock' : 'Unlock';
    editor.apply([{ type: 'update', id, props: { [key]: value } }], { label });
  };

  return (
    <div
      className={`layer-row${selected ? ' is-selected' : ''}${parentSelected ? ' is-child-of-selected' : ''}${!node.visible ? ' is-hidden' : ''}${dropInside ? ' is-drop-inside' : ''}`}
      data-type={node.type}
      role="treeitem"
      aria-selected={selected}
      aria-expanded={hasChildren ? expanded : undefined}
      aria-level={depth + 1}
      style={{ paddingLeft: 4 + depth * INDENT }}
      onPointerDown={(e) => onPointerDown(e, id)}
      onClick={(e) => !renaming && onClick(e, id)}
      onDoubleClick={() => setRenaming(true)}
      onPointerEnter={() => editor.setHover(id)}
      onPointerLeave={() => editor.setHover(null)}
    >
      {hasChildren ? (
        <button
          type="button"
          className="layer-chevron"
          aria-label={expanded ? 'Collapse' : 'Expand'}
          onClick={(e) => (e.stopPropagation(), onToggle(id))}
        >
          <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={12} strokeWidth={2} />
        </button>
      ) : (
        <span className="layer-chevron" />
      )}
      <Icon name={TYPE_ICONS[node.type]} size={14} className="layer-icon" />
      {renaming ? (
        <RenameInput
          initial={node.name}
          onDone={(name) => {
            setRenaming(false);
            if (name && name !== node.name) editor.apply([{ type: 'update', id, props: { name } }], { label: 'Rename' });
          }}
        />
      ) : (
        <span className="layer-name">{displayName(node)}</span>
      )}
      <span className="layer-actions">
        <button
          type="button"
          className={`icon-button${node.locked ? ' is-on' : ''}`}
          aria-label={node.locked ? 'Unlock' : 'Lock'}
          aria-pressed={node.locked}
          onClick={(e) => (e.stopPropagation(), toggleProp('locked'))}
        >
          <Icon name={node.locked ? 'lock' : 'unlock'} size={13} />
        </button>
        <button
          type="button"
          className={`icon-button${!node.visible ? ' is-on' : ''}`}
          aria-label={node.visible ? 'Hide' : 'Show'}
          aria-pressed={!node.visible}
          onClick={(e) => (e.stopPropagation(), toggleProp('visible'))}
        >
          <Icon name={node.visible ? 'eye' : 'eyeOff'} size={13} />
        </button>
      </span>
    </div>
  );
});

function RenameInput({ initial, onDone }: { initial: string; onDone: (name: string) => void }) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (name: string) => {
    if (done.current) return;
    done.current = true;
    onDone(name.trim());
  };
  return (
    <input
      className="layer-rename"
      autoFocus
      aria-label="Layer name"
      value={value}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(value)}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(value);
        if (e.key === 'Escape') finish(initial);
      }}
    />
  );
}
