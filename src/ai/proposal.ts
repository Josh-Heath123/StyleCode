import { tidyFrameOps } from '../model/autolayout';
import { reparentKeepingPosition } from '../model/commands';
import { createNode } from '../model/defaults';
import { collectSubtree, isAncestorOf, isEffectivelyLocked } from '../model/document';
import { OpBuilder, OpError, type Op } from '../model/ops';
import { isPropKey, propAppliesTo } from '../model/properties';
import { CREATABLE_TYPES, CONTAINER_TYPES, type DesignDocument, type NodeProps, type NodeType } from '../model/types';
import type { AiContext } from './context';
import { AI_PROPERTIES } from './schema';

/**
 * Turning an AI reply into operations, safely. The reply is parsed, short ids
 * are mapped back to real ones, and every operation is checked twice: against
 * the AI policy (only the layers it was given, never locked ones, never the
 * screen itself) and by applying it, which runs the same validation as a
 * manual edit. Problems are described with the model's own ids, so they can be
 * sent back for one repair attempt.
 */

export interface Proposal {
  explanation: string;
  ops: Op[];
  /** Layers that will look different (updated, moved or rearranged). */
  changed: string[];
  created: string[];
  /** Layers that will be deleted, and how many layers that removes in total. */
  removed: string[];
  removedCount: number;
  summary: string;
  /** Deletes a lot: accepting asks for a second look. */
  needsConfirmation: boolean;
}

export type Interpretation = { ok: true; proposal: Proposal } | { ok: false; errors: string[]; explanation?: string };

const ALLOWED = new Set<string>(AI_PROPERTIES);
/** Worked out by auto layout, so they may follow from changes around a locked layer. */
const GEOMETRY = new Set<string>(['x', 'y', 'width', 'height']);
const MAX_OPERATIONS = 200;

/** The JSON object in a reply, tolerating code fences or text around it. */
export function extractJson(raw: string): unknown {
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function interpret(raw: string, doc: DesignDocument, context: AiContext): Interpretation {
  const reply = extractJson(raw);
  if (!isRecord(reply)) return { ok: false, errors: ['The reply was not a JSON object.'] };
  const explanation = typeof reply.explanation === 'string' ? reply.explanation.trim().slice(0, 1000) : '';
  if (!Array.isArray(reply.operations)) return { ok: false, errors: ['"operations" must be an array.'], explanation };
  if (reply.operations.length > MAX_OPERATIONS) {
    return {
      ok: false,
      errors: [`Too many operations (${reply.operations.length}); use at most ${MAX_OPERATIONS}.`],
      explanation,
    };
  }

  const builder = new OpBuilder(doc);
  const refs = new Map<string, string>();
  const created = new Set<string>();
  const changed = new Set<string>();
  const removed: string[] = [];
  let removedCount = 0;
  const errors: string[] = [];
  const screen = context.screenId;

  /** A real id for a short id or ref the model used, or null. */
  const resolve = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const id = context.real.get(value) ?? refs.get(value);
    return id && builder.doc.nodes[id] ? id : null;
  };
  const inScope = (id: string) =>
    created.has(id) || context.scope.roots.some((root) => root === id || isAncestorOf(builder.doc, root, id));
  /** Where new or moved layers may go: inside the scope, or beside it in the same parent. */
  const canHold = (id: string) =>
    CONTAINER_TYPES.has(builder.doc.nodes[id].type) &&
    id !== doc.rootId &&
    (inScope(id) || context.scope.roots.some((root) => doc.nodes[root]?.parentId === id));
  /** Whether a layer or anything inside it is locked. */
  const containsLocked = (id: string) => collectSubtree(builder.doc, id).some((node) => node.locked);
  /** The model's name for a layer, for messages it can act on. */
  const nameOf = (id: string) => context.alias.get(id) ?? [...refs].find(([, real]) => real === id)?.[0] ?? id;
  const describe = (message: string) => {
    let out = message;
    for (const [id, short] of context.alias) out = out.split(id).join(short);
    for (const [ref, id] of refs) out = out.split(id).join(ref);
    return out;
  };

  /** Checks a "set" object; returns the properties to apply, or null after recording errors. */
  const properties = (n: number, type: NodeType, set: unknown): Partial<NodeProps> | null => {
    if (set === undefined) return {};
    if (!isRecord(set)) {
      errors.push(`Operation ${n}: "set" must be an object.`);
      return null;
    }
    const out: Record<string, unknown> = {};
    let ok = true;
    for (const [key, value] of Object.entries(set)) {
      if (!isPropKey(key) || !ALLOWED.has(key)) {
        errors.push(`Operation ${n}: "${key}" is not a property you can set.`);
        ok = false;
      } else if (!propAppliesTo(key, type)) {
        errors.push(`Operation ${n}: "${key}" doesn’t apply to ${type} layers.`);
        ok = false;
      } else {
        out[key] = value;
      }
    }
    return ok ? (out as Partial<NodeProps>) : null;
  };

  /** Applies operations, turning validation errors into messages. */
  const tryPush = (n: number, ...ops: Op[]): boolean => {
    try {
      builder.push(...ops);
      return true;
    } catch (error) {
      if (!(error instanceof OpError)) throw error;
      errors.push(`Operation ${n}: ${describe(error.message)}`);
      return false;
    }
  };

  /** A target that may be changed, or null after recording why not. */
  const target = (n: number, value: unknown, verb: string): string | null => {
    const id = resolve(value);
    if (!id) {
      errors.push(`Operation ${n}: there is no layer "${String(value)}".`);
      return null;
    }
    if (!inScope(id)) {
      errors.push(`Operation ${n}: ${nameOf(id)} isn’t one of the layers you may change (marked *).`);
      return null;
    }
    if (isEffectivelyLocked(builder.doc, id)) {
      errors.push(`Operation ${n}: ${nameOf(id)} is locked and can’t be ${verb}.`);
      return null;
    }
    return id;
  };

  const clampIndex = (parent: string, index: unknown, moving?: string) => {
    const count = builder.doc.nodes[parent].children.filter((c) => c !== moving).length;
    return typeof index === 'number' && Number.isFinite(index) ? Math.max(0, Math.min(count, Math.round(index))) : count;
  };

  reply.operations.forEach((raw, i) => {
    const n = i + 1;
    if (!isRecord(raw)) return void errors.push(`Operation ${n} is not an object.`);
    switch (raw.op) {
      case 'update': {
        const id = target(n, raw.id, 'changed');
        if (!id) return;
        const props = properties(n, builder.doc.nodes[id].type, raw.set);
        if (!props || Object.keys(props).length === 0) return;
        if (tryPush(n, { type: 'update', id, props })) changed.add(id);
        return;
      }
      case 'create': {
        if (!CREATABLE_TYPES.includes(raw.type as NodeType)) {
          return void errors.push(`Operation ${n}: "type" must be one of ${CREATABLE_TYPES.join(', ')}.`);
        }
        if (typeof raw.ref !== 'string' || !raw.ref || context.real.has(raw.ref) || refs.has(raw.ref)) {
          return void errors.push(`Operation ${n}: give each new layer a new "ref" such as n1.`);
        }
        const parent = resolve(raw.parent);
        if (!parent) return void errors.push(`Operation ${n}: there is no layer "${String(raw.parent)}" to add to.`);
        if (!canHold(parent)) {
          return void errors.push(`Operation ${n}: new layers can only go inside the layers marked *, or next to them.`);
        }
        if (isEffectivelyLocked(builder.doc, parent)) return void errors.push(`Operation ${n}: ${nameOf(parent)} is locked.`);
        const type = raw.type as NodeType;
        const props = properties(n, type, raw.set);
        if (!props) return;
        const node = createNode(type, props);
        if (tryPush(n, { type: 'create', parentId: parent, index: clampIndex(parent, raw.index), nodes: [node] })) {
          refs.set(raw.ref, node.id);
          created.add(node.id);
        }
        return;
      }
      case 'delete': {
        const id = target(n, raw.id, 'deleted');
        if (!id) return;
        if (id === screen) return void errors.push(`Operation ${n}: the screen itself can’t be deleted.`);
        if (containsLocked(id))
          return void errors.push(`Operation ${n}: ${nameOf(id)} has locked layers inside and can’t be deleted.`);
        const count = collectSubtree(builder.doc, id).length;
        if (tryPush(n, { type: 'delete', id })) {
          if (created.has(id)) created.delete(id);
          else {
            removed.push(id);
            removedCount += count;
          }
          changed.delete(id);
        }
        return;
      }
      case 'move': {
        const id = target(n, raw.id, 'moved');
        if (!id) return;
        if (id === screen) return void errors.push(`Operation ${n}: the screen itself can’t be moved.`);
        const parent = resolve(raw.parent);
        if (!parent) return void errors.push(`Operation ${n}: there is no layer "${String(raw.parent)}" to move into.`);
        if (!canHold(parent))
          return void errors.push(`Operation ${n}: layers can only move into the layers marked *, or next to them.`);
        if (parent === id || isAncestorOf(builder.doc, id, parent)) {
          return void errors.push(`Operation ${n}: ${nameOf(id)} can’t move inside itself.`);
        }
        if (isEffectivelyLocked(builder.doc, parent)) return void errors.push(`Operation ${n}: ${nameOf(parent)} is locked.`);
        const index = clampIndex(parent, raw.index, id);
        const sub = new OpBuilder(builder.doc);
        try {
          if (builder.doc.nodes[id].parentId === parent) sub.push({ type: 'move', id, parentId: parent, index });
          else reparentKeepingPosition(sub, id, parent, index);
        } catch (error) {
          if (!(error instanceof OpError)) throw error;
          return void errors.push(`Operation ${n}: ${describe(error.message)}`);
        }
        if (tryPush(n, ...sub.ops) && !created.has(id)) changed.add(id);
        return;
      }
      case 'tidy': {
        const id = target(n, raw.id, 'rearranged');
        if (!id) return;
        if (builder.doc.nodes[id].type !== 'frame') return void errors.push(`Operation ${n}: only frames can be tidied.`);
        if (containsLocked(id)) {
          return void errors.push(`Operation ${n}: ${nameOf(id)} has locked layers inside and can’t be rearranged.`);
        }
        const result = tidyFrameOps(builder.doc, id);
        if (!result.ok) return void errors.push(`Operation ${n}: ${result.error}`);
        if (tryPush(n, ...result.ops)) {
          changed.add(id);
          for (const op of result.ops) if (op.type === 'create') for (const node of op.nodes) created.add(node.id);
        }
        return;
      }
      default:
        errors.push(`Operation ${n}: "op" must be update, create, delete, move or tidy.`);
    }
  });

  if (errors.length) return { ok: false, errors: [...new Set(errors)].slice(0, 12), explanation };

  // A last check that nothing locked changed, whichever way: still there, in the same frame, with the
  // same properties (apart from the position and size that auto layout works out).
  const after = builder.doc;
  for (const before of collectSubtree(doc, screen)) {
    const id = before.id;
    if (!isEffectivelyLocked(doc, id)) continue;
    const now = after.nodes[id];
    const same =
      now &&
      now.parentId === before.parentId &&
      (Object.keys(before) as (keyof typeof before)[]).every(
        (key) =>
          GEOMETRY.has(key as string) ||
          (key === 'children' ? before.children.join() === now.children.join() : Object.is(before[key], now[key])),
      );
    if (!same) return { ok: false, errors: [`${nameOf(id)} is locked, and these changes would change it.`], explanation };
  }

  const updated = [...changed].filter((id) => builder.doc.nodes[id] && !created.has(id));
  const summary = describeChanges(updated.length, created.size, removedCount);
  const scopeSize = context.scope.roots.reduce((sum, root) => sum + collectSubtree(doc, root).length, 0);
  return {
    ok: true,
    proposal: {
      explanation,
      ops: builder.ops,
      changed: updated,
      created: [...created].filter((id) => builder.doc.nodes[id]),
      removed,
      removedCount,
      summary,
      needsConfirmation: removedCount > 10 || (removedCount >= 3 && removedCount * 2 >= scopeSize),
    },
  };
}

/** "Changes 2 layers and adds 1." */
export function describeChanges(changed: number, added: number, removed: number): string {
  const parts: [string, number][] = (
    [
      ['Changes', changed],
      ['adds', added],
      ['removes', removed],
    ] as [string, number][]
  ).filter(([, n]) => n > 0);
  if (parts.length === 0) return 'No changes.';
  const words = parts.map(
    ([verb, n], i) =>
      `${i === 0 ? verb[0].toUpperCase() + verb.slice(1) : verb} ${n}${i === 0 ? ` layer${n === 1 ? '' : 's'}` : ''}`,
  );
  return `${words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : words[0]}.`;
}

/**
 * The explanation so far, from a reply that is still arriving, so it can be
 * shown while the model writes. It is the first field of the reply.
 */
export function streamedExplanation(partial: string): string | null {
  const key = partial.indexOf('"explanation"');
  if (key < 0) return null;
  const colon = partial.indexOf(':', key + 13);
  if (colon < 0) return null;
  const open = partial.indexOf('"', colon + 1);
  if (open < 0) return null;
  let out = '';
  for (let i = open + 1; i < partial.length; i++) {
    const ch = partial[i];
    if (ch === '"') return out;
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const next = partial[i + 1];
    if (next === undefined) break;
    if (next === 'u') {
      const hex = partial.slice(i + 2, i + 6);
      if (hex.length < 4) break;
      out += String.fromCharCode(parseInt(hex, 16));
      i += 5;
    } else {
      out += { n: '\n', t: '\t', r: '', b: '', f: '' }[next] ?? next;
      i += 1;
    }
  }
  return out;
}
