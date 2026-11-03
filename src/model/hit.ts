import { isEffectivelyHidden, isEffectivelyLocked } from './document';
import { nodeContainsWorldPoint, rectsIntersect, worldBounds } from './geometry';
import type { DesignDocument, Point, Rect } from './types';

/**
 * The deepest visible, unlocked frame containing a world point, or the page
 * if there is none. Used to decide where newly drawn layers go and where
 * dragged layers are dropped.
 */
export function containerAtPoint(doc: DesignDocument, p: Point, exclude: ReadonlySet<string> = new Set()): string {
  const search = (containerId: string): string | null => {
    const container = doc.nodes[containerId];
    for (let i = container.children.length - 1; i >= 0; i--) {
      const id = container.children[i];
      const child = doc.nodes[id];
      if (child.type !== 'frame' || !child.visible || child.locked || exclude.has(id)) continue;
      if (nodeContainsWorldPoint(doc, id, p)) return search(id) ?? id;
    }
    return null;
  };
  return search(doc.rootId) ?? doc.rootId;
}

/**
 * Children of `scopeId` whose world bounds intersect `rect` — the layers a
 * marquee drag selects. Hidden and locked layers are skipped.
 */
export function childrenInRect(doc: DesignDocument, scopeId: string, rect: Rect): string[] {
  const scope = doc.nodes[scopeId];
  if (!scope) return [];
  return scope.children.filter((id) => {
    const node = doc.nodes[id];
    if (!node.visible || node.locked) return false;
    return rectsIntersect(worldBounds(doc, id), rect);
  });
}

/** Whether a layer can currently be selected on the canvas. */
export function isSelectable(doc: DesignDocument, id: string): boolean {
  const node = doc.nodes[id];
  if (!node || node.type === 'page') return false;
  return !isEffectivelyHidden(doc, id) && !isEffectivelyLocked(doc, id);
}
