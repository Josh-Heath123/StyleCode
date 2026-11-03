import { createNode } from './defaults';
import { createId } from './ids';
import { CONTAINER_TYPES, type DesignDocument, type DesignNode } from './types';

export function createDocument(name = 'Untitled'): DesignDocument {
  const root = createNode('page', {}, createId('page'));
  return { id: createId('doc'), name, rootId: root.id, nodes: { [root.id]: root } };
}

/** Whether the document has a layer with this id (own key only, never an inherited property). */
export function hasNode(doc: DesignDocument, id: string): boolean {
  return Object.prototype.hasOwnProperty.call(doc.nodes, id);
}

export function isContainer(node: DesignNode | undefined): boolean {
  return !!node && CONTAINER_TYPES.has(node.type);
}

export function getRoot(doc: DesignDocument): DesignNode {
  return doc.nodes[doc.rootId];
}

/** Ancestor ids from the immediate parent up to (and including) the root. */
export function getAncestors(doc: DesignDocument, id: string): string[] {
  const out: string[] = [];
  let current = doc.nodes[id]?.parentId ?? null;
  while (current) {
    out.push(current);
    current = doc.nodes[current]?.parentId ?? null;
  }
  return out;
}

export function isAncestorOf(doc: DesignDocument, ancestorId: string, id: string): boolean {
  let current = doc.nodes[id]?.parentId ?? null;
  while (current) {
    if (current === ancestorId) return true;
    current = doc.nodes[current]?.parentId ?? null;
  }
  return false;
}

/** Depth of a node; the root has depth 0. */
export function getDepth(doc: DesignDocument, id: string): number {
  return getAncestors(doc, id).length;
}

/** All nodes of the subtree rooted at `id`, in pre-order (the root first). */
export function collectSubtree(doc: DesignDocument, id: string): DesignNode[] {
  const out: DesignNode[] = [];
  const visit = (nodeId: string) => {
    const node = doc.nodes[nodeId];
    if (!node) return;
    out.push(node);
    for (const child of node.children) visit(child);
  };
  visit(id);
  return out;
}

/** Visits every node below `fromId` (exclusive) in pre-order. Return `false` to skip a subtree. */
export function walk(doc: DesignDocument, fromId: string, fn: (node: DesignNode) => boolean | void): void {
  const node = doc.nodes[fromId];
  if (!node) return;
  for (const childId of node.children) {
    const child = doc.nodes[childId];
    if (!child) continue;
    if (fn(child) === false) continue;
    walk(doc, childId, fn);
  }
}

export function indexInParent(doc: DesignDocument, id: string): number {
  const node = doc.nodes[id];
  if (!node?.parentId) return -1;
  return doc.nodes[node.parentId].children.indexOf(id);
}

/** Removes ids whose ancestor is also in the list, so each subtree is only counted once. */
export function topLevelIds(doc: DesignDocument, ids: readonly string[]): string[] {
  const set = new Set(ids);
  return ids.filter((id) => doc.nodes[id] && !getAncestors(doc, id).some((a) => set.has(a)));
}

/** Sorts ids into document (paint) order: a parent before its children, back to front. */
export function sortByDocumentOrder(doc: DesignDocument, ids: readonly string[]): string[] {
  const order = new Map<string, number>();
  let i = 0;
  walk(doc, doc.rootId, (node) => {
    order.set(node.id, i++);
  });
  return [...ids].filter((id) => order.has(id)).sort((a, b) => order.get(a)! - order.get(b)!);
}

/** Whether a node or any of its ancestors is hidden. */
export function isEffectivelyHidden(doc: DesignDocument, id: string): boolean {
  let current: string | null = id;
  while (current) {
    const node: DesignNode | undefined = doc.nodes[current];
    if (!node) return true;
    if (!node.visible) return true;
    current = node.parentId;
  }
  return false;
}

/** Whether a node or any of its ancestors is locked. */
export function isEffectivelyLocked(doc: DesignDocument, id: string): boolean {
  let current: string | null = id;
  while (current) {
    const node: DesignNode | undefined = doc.nodes[current];
    if (!node) return true;
    if (node.locked) return true;
    current = node.parentId;
  }
  return false;
}

/**
 * Checks the structural invariants of a document. Returns a list of problems;
 * an empty list means the document is consistent.
 */
export function checkIntegrity(doc: DesignDocument): string[] {
  const problems: string[] = [];
  const root = doc.nodes[doc.rootId];
  if (!root) return [`Root node ${doc.rootId} is missing`];
  if (root.parentId !== null) problems.push('Root node has a parent');
  if (root.type !== 'page') problems.push('Root node is not a page');

  const seen = new Set<string>();
  const visit = (id: string, parentId: string | null) => {
    const node = doc.nodes[id];
    if (!node) {
      problems.push(`Node ${id} is referenced but missing`);
      return;
    }
    if (seen.has(id)) {
      problems.push(`Node ${id} appears more than once in the tree`);
      return;
    }
    seen.add(id);
    if (node.id !== id) problems.push(`Node stored under ${id} has id ${node.id}`);
    if (node.parentId !== parentId) problems.push(`Node ${id} has parentId ${node.parentId}, expected ${parentId}`);
    if (node.children.length && !isContainer(node)) problems.push(`Node ${id} (${node.type}) cannot have children`);
    for (const child of node.children) visit(child, id);
  };
  visit(doc.rootId, null);

  for (const id of Object.keys(doc.nodes)) {
    if (!seen.has(id)) problems.push(`Node ${id} is not reachable from the root`);
  }
  return problems;
}
