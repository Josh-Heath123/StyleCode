import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '../editor/editor';
import { shallowArrayEqual, useEditor, useEditorState } from '../editor/react';
import { reparentKeepingPosition } from '../model/commands';
import { getAncestors, isAncestorOf, sortByDocumentOrder, topLevelIds } from '../model/document';
import { isAutoLayout } from '../model/layout';
import { OpBuilder } from '../model/ops';
import type { DesignDocument, DesignNode } from '../model/types';
import { Icon, type IconName } from '../ui/Icon';
import { ROLE_LABELS } from './sections';
import { TYPE_ICONS } from './PropertiesPanel';

const ROW_HEIGHT = 28;
const INDENT = 14;
/** Space above the first row (matches the list's top padding in CSS). */
const LIST_PAD = 6;
const OVERSCAN = 8;

interface FlatRow {
  id: string;
  depth: number;
}

/**
 * Whether a container's children are listed in reverse (front-most first, as
 * in a stack of paper). Auto-layout children are listed in reading order
 * instead (first at the top), matching how they appear in the row or column.
 */
const listedFrontFirst = (node: DesignNode) => !isAutoLayout(node);

/** Rows in display order, children under their parent. */
function flatten(doc: DesignDocument, expanded: ReadonlySet<string>): FlatRow[] {
  const rows: FlatRow[] = [];
  const visit = (id: string, depth: number) => {
    const node = doc.nodes[id];
    const children = listedFrontFirst(node) ? [...node.children].reverse() : node.children;
    for (const childId of children) {
      rows.push({ id: childId, depth });
      if (expanded.has(childId) && doc.nodes[childId].children.length) visit(childId, depth + 1);
    }
  };
  visit(doc.rootId, 0);
  return rows;
}

/** Auto-layout frames show their direction, so the structure is readable at a glance. */
function layerIcon(node: DesignNode): IconName {
  if (node.type === 'frame' && node.layout === 'row') return 'arrowRight';
  if (node.type === 'frame' && node.layout === 'column') return 'arrowDown';
  if (node.type === 'frame' && node.layout === 'grid') return 'grid';
  return TYPE_ICONS[node.type];
}

/** Text layers that still have their default name are shown by their content. */
export function displayName(node: DesignNode): string {
  if (node.type === 'text' && node.name === 'Text' && node.text.trim()) return node.text.trim().split('\n')[0].slice(0, 60);
  // Notes are shown by what they say.
  if (node.type === 'note' && /^Note \d+$/.test(node.name) && node.text.trim())
    return node.text.trim().split('\n')[0].slice(0, 60);
  return node.name || 'Untitled';
}

type Drop = { kind: 'inside'; targetId: string } | { kind: 'line'; parentId: string; index: number; y: number; depth: number };

/**
 * The tree's shape: one children array per container, plus which containers
 * list in flow order. Property edits keep these, so rows are only rebuilt when
 * layers are added, removed or reordered, or auto layout is turned on or off.
 * Worked out once per document, not on every hover or camera change.
 */
const shapes = new WeakMap<DesignDocument, (readonly string[] | string)[]>();
function treeShape(doc: DesignDocument): (readonly string[] | string)[] {
  let shape = shapes.get(doc);
  if (shape) return shape;
  const out: (readonly string[] | string)[] = [];
  const walk = (id: string) => {
    const n = doc.nodes[id];
    if (n.children.length === 0) return;
    out.push(n.children);
    if (!listedFrontFirst(n)) out.push(`flow:${id}`);
    n.children.forEach(walk);
  };
  walk(doc.rootId);
  shape = out;
  shapes.set(doc, shape);
  return shape;
}

/** What a row shows. A layer moving or resizing doesn't change it, so rows don't redraw during drags. */
function sameRow(a: DesignNode | undefined, b: DesignNode | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.name === b.name &&
    a.type === b.type &&
    a.visible === b.visible &&
    a.locked === b.locked &&
    a.role === b.role &&
    a.layout === b.layout &&
    a.children.length === b.children.length &&
    (a.type !== 'text' && a.type !== 'note' ? true : a.text === b.text)
  );
}

export function LayersPanel() {
  const editor = useEditor();
  const structure = useEditorState((s) => treeShape(s.doc), shallowArrayEqual);
  const selection = useEditorState((s) => s.selection);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [drop, setDrop] = useState<Drop | null>(null);
  const anchor = useRef<string | null>(null);
  // A drag ends with a click on whatever row is under the pointer; ignore that one click.
  const suppressClick = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, height: 800 });
  // Keyboard: the row the arrow keys are on, and a row to start renaming.
  const [active, setActive] = useState<string | null>(null);
  const [treeFocused, setTreeFocused] = useState(false);
  const [renameRequest, setRenameRequest] = useState<string | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setView({ top: el.scrollTop, height: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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

  // Keep a layer selected on the canvas visible in the list.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || selection.length !== 1) return;
    const index = rows.findIndex((r) => r.id === selection[0]);
    if (index < 0) return;
    const y = LIST_PAD + index * ROW_HEIGHT;
    if (y < el.scrollTop || y + ROW_HEIGHT > el.scrollTop + el.clientHeight) {
      el.scrollTop = Math.max(0, y - el.clientHeight / 2);
    }
  }, [selection, rows]);

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
      setActive(id);
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
      const top = list.getBoundingClientRect().top + LIST_PAD;
      const pos = clientY - top;
      const i = Math.max(0, Math.min(rows.length - 1, Math.floor(pos / ROW_HEIGHT)));
      const row = rows[i];
      const node = doc.nodes[row.id];
      const within = pos / ROW_HEIGHT - i; // 0..1 inside the row
      const invalid = (parentId: string) =>
        dragged.some(
          (d) => d === parentId || isAncestorOf(doc, d, parentId) || (doc.nodes[d]?.type === 'note' && parentId !== doc.rootId),
        );

      if (node.type === 'frame' && within > 0.25 && within < 0.75 && !invalid(row.id)) {
        return { kind: 'inside', targetId: row.id };
      }
      const parentId = node.parentId!;
      if (invalid(parentId)) return null;
      const siblings = doc.nodes[parentId].children;
      const idx = siblings.indexOf(row.id);
      // In front-first lists "above" a row means in front of it (a higher index);
      // in auto-layout lists it means before it in the flow.
      const frontFirst = listedFrontFirst(doc.nodes[parentId]);
      if (pos < 0 || within <= 0.5)
        return { kind: 'line', parentId, index: frontFirst ? idx + 1 : idx, y: i * ROW_HEIGHT + LIST_PAD, depth: row.depth };
      return { kind: 'line', parentId, index: frontFirst ? idx : idx + 1, y: (i + 1) * ROW_HEIGHT + LIST_PAD, depth: row.depth };
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

  // Stable, so the memoised rows don't redraw whenever the list does.
  const onRenameDone = useCallback(() => {
    setRenameRequest(null);
    listRef.current?.focus();
  }, []);

  const activeId =
    active && rows.some((r) => r.id === active)
      ? active
      : (selection.find((id) => rows.some((r) => r.id === id)) ?? rows[0]?.id ?? null);

  const scrollToRow = (index: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const y = LIST_PAD + index * ROW_HEIGHT;
    if (y < el.scrollTop) el.scrollTop = y - LIST_PAD;
    else if (y + ROW_HEIGHT > el.scrollTop + el.clientHeight) el.scrollTop = y + ROW_HEIGHT - el.clientHeight + LIST_PAD;
  };

  /**
   * The layer tree from the keyboard (selection follows the arrow keys):
   * Up and Down move, Shift extends the selection, Right opens a layer or goes
   * into it, Left closes it or goes to its parent, Home and End jump, Enter or
   * F2 renames, Space adds or removes the layer from the selection.
   */
  const onTreeKeyDown = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget || rows.length === 0) return;
    const { doc } = editor.getState();
    const i = Math.max(
      0,
      rows.findIndex((r) => r.id === activeId),
    );
    const go = (index: number, extend = false) => {
      const to = Math.max(0, Math.min(rows.length - 1, index));
      const id = rows[to].id;
      setActive(id);
      if (extend && anchor.current) {
        const a = rows.findIndex((r) => r.id === anchor.current);
        const [from, until] = a < to ? [a, to] : [to, a];
        editor.select(rows.slice(from, until + 1).map((r) => r.id));
      } else {
        editor.select([id]);
        anchor.current = id;
      }
      scrollToRow(to);
    };
    const row = rows[i];
    const node = doc.nodes[row.id];
    switch (e.key) {
      case 'ArrowDown':
        go(i + 1, e.shiftKey);
        break;
      case 'ArrowUp':
        go(i - 1, e.shiftKey);
        break;
      case 'Home':
        go(0, e.shiftKey);
        break;
      case 'End':
        go(rows.length - 1, e.shiftKey);
        break;
      case 'ArrowRight':
        if (node.children.length && !expanded.has(row.id)) handlers.toggle(row.id);
        else if (node.children.length) go(i + 1);
        break;
      case 'ArrowLeft':
        if (node.children.length && expanded.has(row.id)) handlers.toggle(row.id);
        else if (node.parentId && node.parentId !== doc.rootId) go(rows.findIndex((r) => r.id === node.parentId));
        break;
      case 'Enter':
      case 'F2':
        setRenameRequest(row.id);
        break;
      case ' ': {
        const current = editor.getState().selection;
        editor.select(current.includes(row.id) ? current.filter((id) => id !== row.id) : [...current, row.id]);
        break;
      }
      default:
        return;
    }
    // Arrow keys here move through the list; they don't also nudge the selection on the canvas.
    e.preventDefault();
    e.stopPropagation();
  };

  // Only the rows in view are rendered, so very large documents stay responsive.
  const first = Math.max(0, Math.floor((view.top - LIST_PAD) / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((view.top + view.height) / ROW_HEIGHT) + OVERSCAN);

  return (
    <>
      <div
        className="panel-scroll"
        ref={scrollRef}
        onScroll={(e) => setView((v) => ({ ...v, top: (e.target as HTMLElement).scrollTop }))}
      >
        {rows.length === 0 ? (
          <p className="layers-empty">Nothing on the page yet. Draw a frame with F or pick a size on the right.</p>
        ) : (
          <div
            className="layers"
            ref={listRef}
            role="tree"
            aria-label="Layers"
            aria-multiselectable="true"
            tabIndex={0}
            aria-activedescendant={activeId ? `layer-${activeId}` : undefined}
            onKeyDown={onTreeKeyDown}
            onFocus={(e) => e.target === e.currentTarget && setTreeFocused(true)}
            onBlur={(e) => e.target === e.currentTarget && setTreeFocused(false)}
            style={{ height: rows.length * ROW_HEIGHT + LIST_PAD + 24 }}
          >
            {rows.slice(first, last).map((row, i) => (
              <LayerRow
                key={row.id}
                id={row.id}
                top={LIST_PAD + (first + i) * ROW_HEIGHT}
                depth={row.depth}
                expanded={expanded.has(row.id)}
                insideSelection={insideSelection.has(row.id)}
                dropInside={drop?.kind === 'inside' && drop.targetId === row.id}
                active={treeFocused && row.id === activeId}
                renameRequested={renameRequest === row.id}
                onRenameDone={onRenameDone}
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
  top: number;
  depth: number;
  expanded: boolean;
  insideSelection: boolean;
  dropInside: boolean;
  active: boolean;
  renameRequested: boolean;
  onRenameDone: () => void;
  editor: Editor;
  onToggle: (id: string) => void;
  onClick: (e: React.MouseEvent, id: string) => void;
  onPointerDown: (e: React.PointerEvent, id: string) => void;
}

const LayerRow = memo(function LayerRow({
  id,
  top,
  depth,
  expanded,
  insideSelection,
  dropInside,
  active,
  renameRequested,
  onRenameDone,
  editor,
  onToggle,
  onClick,
  onPointerDown,
}: LayerRowProps) {
  const node = useEditorState((s) => s.doc.nodes[id], sameRow);
  const selected = useEditorState((s) => s.selection.includes(id));
  const parentSelected = insideSelection && !selected;
  const [renaming, setRenaming] = useState(false);
  useEffect(() => {
    if (renameRequested) setRenaming(true);
  }, [renameRequested]);
  if (!node) return null;

  const hasChildren = node.children.length > 0;
  const toggleProp = (key: 'visible' | 'locked') => {
    const value = !node[key];
    const label = key === 'visible' ? (value ? 'Show' : 'Hide') : value ? 'Lock' : 'Unlock';
    editor.apply([{ type: 'update', id, props: { [key]: value } }], { label });
  };

  return (
    <div
      className={`layer-row${selected ? ' is-selected' : ''}${parentSelected ? ' is-child-of-selected' : ''}${!node.visible ? ' is-hidden' : ''}${dropInside ? ' is-drop-inside' : ''}${active ? ' is-active' : ''}`}
      data-type={node.type}
      id={`layer-${id}`}
      aria-label={`${displayName(node)}, ${node.type}${node.locked ? ', locked' : ''}${!node.visible ? ', hidden' : ''}`}
      role="treeitem"
      aria-selected={selected}
      aria-expanded={hasChildren ? expanded : undefined}
      aria-level={depth + 1}
      style={{ top, paddingLeft: 4 + depth * INDENT }}
      onPointerDown={(e) => onPointerDown(e, id)}
      onClick={(e) => !renaming && onClick(e, id)}
      onDoubleClick={() => setRenaming(true)}
      onPointerEnter={() => editor.setHover(id)}
      onPointerLeave={() => editor.setHover(null)}
    >
      {hasChildren ? (
        // The row's buttons are for the pointer: from the keyboard the tree is one tab stop,
        // with arrows to open and close, and Ctrl+Shift+L / H to lock and hide.
        <button
          type="button"
          className="layer-chevron"
          tabIndex={-1}
          aria-label={expanded ? 'Collapse' : 'Expand'}
          onClick={(e) => (e.stopPropagation(), onToggle(id))}
        >
          <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={12} strokeWidth={2} />
        </button>
      ) : (
        <span className="layer-chevron" />
      )}
      <Icon name={layerIcon(node)} size={14} className="layer-icon" />
      {renaming ? (
        <RenameInput
          initial={node.name}
          onDone={(name) => {
            setRenaming(false);
            if (name && name !== node.name) editor.apply([{ type: 'update', id, props: { name } }], { label: 'Rename' });
            if (renameRequested) onRenameDone();
          }}
        />
      ) : (
        <span className="layer-name">{displayName(node)}</span>
      )}
      {node.role !== 'auto' && !renaming && !displayName(node).toLowerCase().includes(ROLE_LABELS[node.role].toLowerCase()) && (
        <span className="layer-role">{node.role}</span>
      )}
      <span className="layer-actions">
        <button
          type="button"
          className={`icon-button${node.locked ? ' is-on' : ''}`}
          tabIndex={-1}
          aria-label={node.locked ? 'Unlock' : 'Lock'}
          aria-pressed={node.locked}
          onClick={(e) => (e.stopPropagation(), toggleProp('locked'))}
        >
          <Icon name={node.locked ? 'lock' : 'unlock'} size={13} />
        </button>
        <button
          type="button"
          className={`icon-button${!node.visible ? ' is-on' : ''}`}
          tabIndex={-1}
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
