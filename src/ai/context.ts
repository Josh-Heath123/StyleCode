import { defaultProps } from '../model/defaults';
import { isAncestorOf, isEffectivelyLocked, topLevelIds } from '../model/document';
import { rectsIntersect, worldBounds } from '../model/geometry';
import type { DesignDocument, DesignNode, NodeProps, PropKey } from '../model/types';
import { AI_PROPERTIES } from './schema';

/**
 * What the AI is told about the design. Small models have small context
 * windows, so instead of the whole document it gets one screen as a compact
 * indented tree: the layers it may change (marked *) with every property that
 * differs from the defaults, and the rest of the screen as one-line
 * summaries, trimmed to fit a character budget. Layers are referred to by
 * short ids (e1, e2…) rather than real ids, which saves tokens and makes
 * mistyped references unlikely.
 */

export interface AiScope {
  /** 'screen' when the whole screen may change, 'selection' for selected layers only. */
  kind: 'screen' | 'selection';
  /** The layers that may change, with everything inside them. */
  roots: string[];
}

export interface AiContext {
  screenId: string;
  scope: AiScope;
  /** The tree as the model sees it. */
  text: string;
  /** Short id → real id, and back. */
  real: Map<string, string>;
  alias: Map<string, string>;
  /** Plain description of the target, for the UI ("Shared by default card"). */
  targetLabel: string;
  /** How many of the designer's notes are on (or point at) this screen. */
  notes: number;
}

/**
 * The designer's notes about a screen: notes that point at a layer on it, or
 * that sit over it. They are instructions, written on the canvas.
 */
export function notesFor(doc: DesignDocument, screenId: string): DesignNode[] {
  const screenBox = worldBounds(doc, screenId);
  return doc.nodes[doc.rootId].children
    .map((id) => doc.nodes[id])
    .filter((n) => n.type === 'note' && n.visible && n.text.trim())
    .filter((n) => {
      const target = n.noteTarget && doc.nodes[n.noteTarget];
      if (target) return n.noteTarget === screenId || isAncestorOf(doc, screenId, n.noteTarget);
      return rectsIntersect(worldBounds(doc, n.id), screenBox);
    });
}

const shortName = (node: DesignNode) => node.name || node.type;

function inScope(doc: DesignDocument, scope: AiScope, id: string): boolean {
  return scope.roots.some((root) => root === id || isAncestorOf(doc, root, id));
}

function formatValue(value: unknown, limit = 300): string {
  // Colours and keywords as they would be written in a reply; other text quoted.
  if (typeof value === 'string' && /^(#[0-9a-fA-F]{6,8}|[a-z][\w-]*)$/.test(value)) return value;
  if (typeof value === 'string') {
    const text = value.length > limit ? `${value.slice(0, limit)}…` : value;
    return JSON.stringify(text);
  }
  if (typeof value === 'number') return String(Math.round(value * 100) / 100);
  return String(value);
}

/** Properties that differ from a layer type's defaults, as `key=value` pairs. */
function changedProps(node: DesignNode): string[] {
  const defaults = defaultProps(node.type);
  const out: string[] = [];
  for (const key of AI_PROPERTIES) {
    if (key === 'name' || key === 'width' || key === 'height' || key === 'text') continue;
    const value = node[key as PropKey];
    if (value === defaults[key as keyof NodeProps]) continue;
    out.push(`${key}=${formatValue(value)}`);
  }
  return out;
}

function summary(node: DesignNode): string[] {
  const parts: string[] = [];
  if (node.type === 'frame' && node.layout !== 'none') parts.push(`layout=${node.layout}`);
  if (node.role !== 'auto') parts.push(`role=${node.role}`);
  if (!node.visible) parts.push('visible=false');
  return parts;
}

function line(node: DesignNode, alias: string, full: boolean, marked: boolean, locked: boolean): string {
  const parts = [
    `${marked ? '* ' : ''}${alias}`,
    node.type,
    JSON.stringify(shortName(node)),
    `${Math.round(node.width)}×${Math.round(node.height)}`,
  ];
  if (node.type === 'text') parts.push(`text=${formatValue(node.text, full ? 2000 : 80)}`);
  parts.push(...(full ? changedProps(node) : summary(node)));
  if (locked) parts.push('locked');
  return parts.join(' ');
}

export interface ContextOptions {
  /** Upper bound on the tree's length in characters (about four per token). */
  maxChars?: number;
  /** The screen to use when nothing is selected. */
  fallbackScreen?: string | null;
}

/** The screen (top-level frame) a layer is in. */
function screenOf(doc: DesignDocument, id: string): string | null {
  let node: DesignNode | undefined = doc.nodes[id];
  while (node?.parentId && node.parentId !== doc.rootId) node = doc.nodes[node.parentId];
  return node?.parentId === doc.rootId && node.type === 'frame' ? node.id : null;
}

export interface AiTarget {
  screenId: string;
  scope: AiScope;
  /** Plain description of the target, for the UI. */
  targetLabel: string;
}

/**
 * What a request would change: the selected layers (those on the same screen
 * as the first one), or the whole screen in view when nothing is selected.
 */
export function resolveTarget(
  doc: DesignDocument,
  selection: readonly string[],
  fallbackScreen: string | null = null,
): AiTarget | { error: string } {
  const selected = topLevelIds(doc, selection).filter((id) => doc.nodes[id] && id !== doc.rootId);
  const screenId = selected.length
    ? screenOf(doc, selected[0])
    : fallbackScreen && doc.nodes[fallbackScreen]
      ? fallbackScreen
      : null;
  if (!screenId) {
    return { error: selected.length ? 'Select layers inside a frame.' : 'Draw a frame first, or select the layers to change.' };
  }
  const roots = selected.filter((id) => screenOf(doc, id) === screenId);
  const scope: AiScope =
    roots.length === 0 || roots.includes(screenId) ? { kind: 'screen', roots: [screenId] } : { kind: 'selection', roots };
  const targetLabel =
    scope.kind === 'screen'
      ? `the screen “${shortName(doc.nodes[screenId])}”`
      : roots.length === 1
        ? `“${shortName(doc.nodes[roots[0]])}”`
        : `${roots.length} selected layers`;
  return { screenId, scope, targetLabel };
}

export function buildContext(
  doc: DesignDocument,
  selection: readonly string[],
  options: ContextOptions = {},
): AiContext | { error: string } {
  const maxChars = options.maxChars ?? 12_000;
  const target = resolveTarget(doc, selection, options.fallbackScreen ?? null);
  if ('error' in target) return target;
  const { screenId, scope, targetLabel } = target;

  // Short ids in document order.
  const order: string[] = [];
  const depth = new Map<string, number>();
  const visit = (id: string, d: number) => {
    order.push(id);
    depth.set(id, d);
    doc.nodes[id].children.forEach((c) => visit(c, d + 1));
  };
  visit(screenId, 0);
  const alias = new Map<string, string>();
  const real = new Map<string, string>();
  order.forEach((id, i) => {
    alias.set(id, `e${i + 1}`);
    real.set(`e${i + 1}`, id);
  });

  // The designer's notes come out of the same budget: up to a quarter of it, longest notes trimmed.
  const notes = notesFor(doc, screenId);
  const noteBudget = Math.max(600, maxChars / 4);
  const noteLines: string[] = [];
  let noteChars = 0;
  for (const [i, n] of notes.entries()) {
    const on = n.noteTarget && alias.get(n.noteTarget);
    const where = on ? ` (on ${on} ${JSON.stringify(shortName(doc.nodes[n.noteTarget]))})` : '';
    const text = `- ${formatValue(n.text, 600)}${where}`;
    if (noteLines.length > 0 && noteChars + text.length + 1 > noteBudget) {
      noteLines.push(`- … ${notes.length - i} more ${notes.length - i === 1 ? 'note' : 'notes'} not shown`);
      break;
    }
    noteLines.push(text);
    noteChars += text.length + 1;
  }
  if (noteLines.length) noteLines.unshift('', 'Notes from the designer:');

  // Every layer that may change is shown in full; ancestors always; the rest while there is room.
  const lines = new Map<string, string>();
  let used = noteLines.reduce((sum, l) => sum + l.length + 1, 0);
  const render = (id: string) => {
    const node = doc.nodes[id];
    const marked = inScope(doc, scope, id);
    // On a very large screen, layers past the budget are summarised even when they may change.
    const full = marked && used < maxChars * 0.8;
    return `${'  '.repeat(depth.get(id)!)}${line(node, alias.get(id)!, full, marked, isEffectivelyLocked(doc, id))}`;
  };
  const include = (id: string) => {
    if (lines.has(id)) return;
    const text = render(id);
    lines.set(id, text);
    used += text.length + 1;
  };
  for (const id of order) if (inScope(doc, scope, id)) include(id);
  for (const root of scope.roots) {
    for (let p = doc.nodes[root].parentId; p && p !== doc.rootId; p = doc.nodes[p].parentId) include(p);
  }
  // Then nearby layers first: siblings of what may change, then everything else in order.
  const nearby = scope.roots.flatMap((root) => doc.nodes[doc.nodes[root].parentId ?? '']?.children ?? []);
  for (const id of [...nearby, ...order]) {
    if (lines.has(id)) continue;
    const text = render(id);
    if (used + text.length + 1 > maxChars) continue;
    lines.set(id, text);
    used += text.length + 1;
  }

  const out: string[] = [];
  let skipped = 0;
  for (const id of order) {
    const text = lines.get(id);
    if (text === undefined) {
      skipped++;
      continue;
    }
    if (skipped) {
      out.push(`${'  '.repeat(depth.get(id)!)}… ${skipped} more layer${skipped === 1 ? '' : 's'} not shown`);
      skipped = 0;
    }
    out.push(text);
  }
  if (skipped) out.push(`… ${skipped} more layer${skipped === 1 ? '' : 's'} not shown`);

  const screen = doc.nodes[screenId];
  const header = [
    `Screen ${alias.get(screenId)} ${JSON.stringify(shortName(screen))}, ${Math.round(screen.width)}×${Math.round(screen.height)}.`,
    scope.kind === 'screen'
      ? 'You may change anything on this screen.'
      : `Selected: ${scope.roots.map((r) => alias.get(r)).join(', ')}. You may change the layers marked * and add layers inside or next to them.`,
    '',
  ];
  return { screenId, scope, text: [...header, ...out, ...noteLines].join('\n'), real, alias, targetLabel, notes: notes.length };
}
