import { isValidId } from './ids';
import { coerceProp, isPropKey, propAppliesTo, PROP_KEYS } from './properties';
import { CONTAINER_TYPES, CREATABLE_TYPES, type DesignDocument, type DesignNode, type NodeProps, type PropKey } from './types';

/**
 * Operations are the only way a document changes.
 *
 * There are four of them. Every operation is validated before it is applied
 * and produces its own inverse, so any sequence of operations can be undone
 * exactly. Manual edits, undo/redo and (later) AI proposals all go through
 * `applyOps`, which is atomic: either every operation in the batch applies or
 * the document is left untouched.
 */
export type Op =
  /** Inserts a subtree. `nodes[0]` is the subtree root; the rest are its descendants in pre-order. */
  | { type: 'create'; parentId: string; index: number; nodes: DesignNode[] }
  /** Removes a node and its whole subtree. */
  | { type: 'delete'; id: string }
  /** Sets properties on a node. */
  | { type: 'update'; id: string; props: Partial<NodeProps> }
  /** Re-parents and/or re-orders a node. `index` is the position among the new parent's children. */
  | { type: 'move'; id: string; parentId: string; index: number };

export class OpError extends Error {
  constructor(
    message: string,
    readonly opIndex: number,
  ) {
    super(message);
    this.name = 'OpError';
  }
}

export interface ApplyResult {
  doc: DesignDocument;
  /** Operations that exactly revert this batch, in the order they must be applied. */
  inverse: Op[];
  /** Ids of nodes created, updated, moved or deleted. */
  touched: Set<string>;
}

/**
 * Copy-on-write view of the node map. Each node is copied at most once per
 * batch, so applying N operations costs one map copy plus the touched nodes.
 */
class Draft {
  readonly nodes: Record<string, DesignNode>;
  private readonly copied = new Set<string>();
  private readonly copiedChildren = new Set<string>();

  constructor(base: DesignDocument) {
    this.nodes = { ...base.nodes };
  }

  get(id: string): DesignNode | undefined {
    return Object.prototype.hasOwnProperty.call(this.nodes, id) ? this.nodes[id] : undefined;
  }

  /** A copy of the node that is safe to modify. Its children array is still shared. */
  mutable(id: string): DesignNode {
    if (!this.copied.has(id)) {
      this.nodes[id] = { ...this.nodes[id] };
      this.copied.add(id);
    }
    return this.nodes[id];
  }

  /**
   * The node's children array, copied once per batch so it can be modified.
   * Property-only edits never copy it, so an unchanged tree keeps the same
   * arrays — which lets the layer list skip work during drags.
   */
  mutableChildren(id: string): string[] {
    const node = this.mutable(id);
    if (!this.copiedChildren.has(id)) {
      node.children = [...node.children];
      this.copiedChildren.add(id);
    }
    return node.children;
  }

  insert(node: DesignNode): void {
    this.nodes[node.id] = node;
    this.copied.add(node.id);
    this.copiedChildren.add(node.id);
  }

  remove(id: string): void {
    delete this.nodes[id];
    this.copied.delete(id);
    this.copiedChildren.delete(id);
  }

  isAncestorOf(ancestorId: string, id: string): boolean {
    let current = this.nodes[id]?.parentId ?? null;
    while (current) {
      if (current === ancestorId) return true;
      current = this.nodes[current]?.parentId ?? null;
    }
    return false;
  }
}

function clampIndex(index: number, length: number): number {
  if (!Number.isInteger(index) || index < 0 || index > length) return length;
  return index;
}

function fail(message: string, opIndex: number): never {
  throw new OpError(message, opIndex);
}

function applyUpdate(draft: Draft, op: Extract<Op, { type: 'update' }>, i: number): Op | null {
  const node = draft.get(op.id);
  if (!node) fail(`Cannot update ${op.id}: no such layer`, i);
  if (!op.props || typeof op.props !== 'object') fail(`Update of ${op.id} has no properties`, i);

  const next: Partial<Record<PropKey, unknown>> = {};
  const previous: Partial<Record<PropKey, unknown>> = {};
  for (const [key, raw] of Object.entries(op.props)) {
    if (!isPropKey(key)) fail(`Unknown property "${key}"`, i);
    if (!propAppliesTo(key, node.type)) fail(`"${key}" does not apply to ${node.type} layers`, i);
    const result = coerceProp(key, raw);
    if (!result.ok) fail(result.error, i);
    if (node[key] !== result.value) {
      next[key] = result.value;
      previous[key] = node[key];
    }
  }
  if (Object.keys(next).length === 0) return null;
  Object.assign(draft.mutable(op.id), next);
  return { type: 'update', id: op.id, props: previous as Partial<NodeProps> };
}

function validateNewNode(node: DesignNode, i: number): DesignNode {
  if (!node || typeof node !== 'object') fail('Created layer is not an object', i);
  if (!isValidId(node.id)) fail(`"${String(node.id)}" is not a valid layer id`, i);
  if (!CREATABLE_TYPES.includes(node.type)) fail(`Cannot create a layer of type "${String(node.type)}"`, i);
  if (!Array.isArray(node.children)) fail(`Layer ${node.id} has no children list`, i);
  if (node.children.length && !CONTAINER_TYPES.has(node.type)) fail(`A ${node.type} layer cannot have children`, i);
  const clean = { id: node.id, type: node.type, parentId: node.parentId, children: [...node.children] } as DesignNode;
  for (const key of PROP_KEYS) {
    const result = coerceProp(key, node[key]);
    if (!result.ok) fail(`Layer ${node.id}: ${result.error}`, i);
    (clean as unknown as Record<string, unknown>)[key] = result.value;
  }
  return clean;
}

function applyCreate(draft: Draft, op: Extract<Op, { type: 'create' }>, i: number): Op {
  const parent = draft.get(op.parentId);
  if (!parent) fail(`Cannot create inside ${op.parentId}: no such layer`, i);
  if (!CONTAINER_TYPES.has(parent.type)) fail(`A ${parent.type} layer cannot contain other layers`, i);
  if (!Array.isArray(op.nodes) || op.nodes.length === 0) fail('Create operation has no layers', i);

  const incoming = new Map<string, DesignNode>();
  for (const raw of op.nodes) {
    const node = validateNewNode(raw, i);
    if (draft.get(node.id) || incoming.has(node.id)) fail(`Layer id ${node.id} already exists`, i);
    incoming.set(node.id, node);
  }

  // Every node except the root must be referenced exactly once by a parent in the batch.
  const rootId = op.nodes[0].id;
  const referenced = new Set<string>();
  for (const node of incoming.values()) {
    for (const childId of node.children) {
      const child = incoming.get(childId);
      if (!child) fail(`Layer ${node.id} references missing child ${childId}`, i);
      if (referenced.has(childId) || childId === rootId) fail(`Layer ${childId} is listed as a child more than once`, i);
      referenced.add(childId);
      child.parentId = node.id;
    }
  }
  const root = incoming.get(rootId)!;
  let reachable = 0;
  const count = (node: DesignNode) => {
    reachable++;
    node.children.forEach((childId) => count(incoming.get(childId)!));
  };
  count(root);
  if (reachable !== incoming.size) fail('Created layers do not form a single tree', i);

  root.parentId = op.parentId;
  for (const node of incoming.values()) draft.insert(node);
  const siblings = draft.mutableChildren(op.parentId);
  siblings.splice(clampIndex(op.index, siblings.length), 0, rootId);
  return { type: 'delete', id: rootId };
}

function applyDelete(draft: Draft, op: Extract<Op, { type: 'delete' }>, i: number): Op {
  const node = draft.get(op.id);
  if (!node) fail(`Cannot delete ${op.id}: no such layer`, i);
  if (!node.parentId) fail('The page cannot be deleted', i);

  const subtree: DesignNode[] = [];
  const collect = (id: string) => {
    const n = draft.get(id)!;
    subtree.push(n);
    n.children.forEach(collect);
  };
  collect(op.id);

  const siblings = draft.mutableChildren(node.parentId);
  const index = siblings.indexOf(op.id);
  siblings.splice(index, 1);
  for (const n of subtree) draft.remove(n.id);

  // Snapshots are immutable from here on, so the inverse can hold them directly.
  return { type: 'create', parentId: node.parentId, index, nodes: subtree };
}

function applyMove(draft: Draft, op: Extract<Op, { type: 'move' }>, i: number): Op | null {
  const node = draft.get(op.id);
  if (!node) fail(`Cannot move ${op.id}: no such layer`, i);
  if (!node.parentId) fail('The page cannot be moved', i);
  const target = draft.get(op.parentId);
  if (!target) fail(`Cannot move into ${op.parentId}: no such layer`, i);
  if (!CONTAINER_TYPES.has(target.type)) fail(`A ${target.type} layer cannot contain other layers`, i);
  if (op.parentId === op.id || draft.isAncestorOf(op.id, op.parentId)) fail('A layer cannot be moved inside itself', i);

  const oldParentId = node.parentId;
  const oldIndex = draft.get(oldParentId)!.children.indexOf(op.id);

  const oldSiblings = draft.mutableChildren(oldParentId);
  oldSiblings.splice(oldIndex, 1);
  const newSiblings = draft.mutableChildren(op.parentId);
  const index = clampIndex(op.index, newSiblings.length);
  if (oldParentId === op.parentId && index === oldIndex) {
    oldSiblings.splice(oldIndex, 0, op.id);
    return null;
  }
  newSiblings.splice(index, 0, op.id);
  draft.mutable(op.id).parentId = op.parentId;
  return { type: 'move', id: op.id, parentId: oldParentId, index: oldIndex };
}

/**
 * Applies a batch of operations atomically.
 * @throws OpError describing the first invalid operation; the input document is never modified.
 */
export function applyOps(doc: DesignDocument, ops: readonly Op[]): ApplyResult {
  const draft = new Draft(doc);
  const inverse: Op[] = [];
  const touched = new Set<string>();

  ops.forEach((op, i) => {
    if (!op || typeof op !== 'object') fail('Operation is not an object', i);
    let inv: Op | null;
    switch (op.type) {
      case 'update':
        inv = applyUpdate(draft, op, i);
        touched.add(op.id);
        break;
      case 'create':
        inv = applyCreate(draft, op, i);
        op.nodes.forEach((n) => touched.add(n.id));
        break;
      case 'delete':
        inv = applyDelete(draft, op, i);
        touched.add(op.id);
        break;
      case 'move':
        inv = applyMove(draft, op, i);
        touched.add(op.id);
        break;
      default:
        fail(`Unknown operation type "${(op as { type?: unknown }).type}"`, i);
    }
    if (inv) inverse.push(inv);
  });

  inverse.reverse();
  return { doc: { ...doc, nodes: draft.nodes }, inverse, touched };
}

export type TryApplyResult = ({ ok: true } & ApplyResult) | { ok: false; error: string; opIndex: number };

/** Non-throwing variant of `applyOps`, used to validate untrusted batches. */
export function tryApplyOps(doc: DesignDocument, ops: readonly Op[]): TryApplyResult {
  try {
    return { ok: true, ...applyOps(doc, ops) };
  } catch (error) {
    if (error instanceof OpError) return { ok: false, error: error.message, opIndex: error.opIndex };
    throw error;
  }
}

/**
 * Builds a batch incrementally against a working copy, so that each
 * operation can be computed from the state the previous ones produced.
 */
export class OpBuilder {
  doc: DesignDocument;
  readonly ops: Op[] = [];

  constructor(doc: DesignDocument) {
    this.doc = doc;
  }

  push(...ops: Op[]): this {
    if (ops.length === 0) return this;
    this.doc = applyOps(this.doc, ops).doc;
    this.ops.push(...ops);
    return this;
  }
}
