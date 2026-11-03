import type { Normalizer } from '../editor/editor';
import type { Op } from '../model/ops';
import { resizeAroundAnchor } from '../model/transform';
import type { DesignNode, NodeProps } from '../model/types';
import { textDeclarations } from '../render/css';

/**
 * Text measurement for auto-sizing text layers. Measuring uses the same CSS
 * as the canvas renderer, in a hidden element outside the zoomed canvas, so
 * the measured size is exactly the rendered size.
 */

let host: HTMLDivElement | null = null;
const cache = new Map<string, { width: number; height: number }>();
const CACHE_LIMIT = 1000;

function measureElement(): HTMLDivElement {
  if (!host) {
    host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    Object.assign(host.style, {
      position: 'absolute',
      left: '-100000px',
      top: '0',
      visibility: 'hidden',
      pointerEvents: 'none',
      contain: 'layout style',
    });
    host.appendChild(document.createElement('div'));
    document.body.appendChild(host);
  }
  return host.firstChild as HTMLDivElement;
}

export function measureText(node: DesignNode): { width: number; height: number } {
  const key = [
    node.text,
    node.fontFamily,
    node.fontSize,
    node.fontWeight,
    node.lineHeight,
    node.letterSpacing,
    node.textResize,
    node.textResize === 'auto-width' ? '' : node.width,
  ].join('\u0000');
  const hit = cache.get(key);
  if (hit) return hit;

  const el = measureElement();
  el.removeAttribute('style');
  const css = textDeclarations(node);
  for (const [prop, value] of Object.entries(css)) {
    if (value !== undefined) (el.style as unknown as Record<string, string>)[prop] = String(value);
  }
  el.style.position = 'absolute';
  el.style.boxSizing = 'border-box';
  el.style.width = node.textResize === 'auto-width' ? 'max-content' : `${node.width}px`;
  // An empty text layer still occupies one line.
  el.textContent = node.text || '​';
  const rect = el.getBoundingClientRect();
  const size = { width: Math.max(1, Math.ceil(rect.width)), height: Math.max(1, Math.ceil(rect.height)) };

  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(key, size);
  return size;
}

/** Fonts change metrics once they finish loading, so cached sizes must be dropped. */
export function clearMeasureCache(): void {
  cache.clear();
}

const ALIGN_ANCHOR = { left: 0, center: 0.5, right: 1 } as const;

/**
 * Keeps auto-sizing text layers fitted to their content. Runs inside the same
 * transaction as the edit that changed the text, so undo restores both.
 */
export const textAutoSize: Normalizer = (doc, touched, base) => {
  const ops: Op[] = [];
  for (const id of touched) {
    const node = doc.nodes[id];
    if (!node || node.type !== 'text' || node.textResize === 'fixed') continue;
    const size = measureText(node);
    const width = node.textResize === 'auto-width' ? size.width : node.width;
    const height = size.height;
    if (Math.abs(width - node.width) < 0.5 && Math.abs(height - node.height) < 0.5) continue;

    const props: Partial<NodeProps> = { width, height };
    // Existing text grows from its alignment edge (which matters once it is rotated);
    // new text keeps the position it was created at.
    if (base.nodes[id]) {
      const r = resizeAroundAnchor(node, width, height, ALIGN_ANCHOR[node.textAlign], 0);
      props.x = Math.round(r.x * 100) / 100;
      props.y = Math.round(r.y * 100) / 100;
    }
    ops.push({ type: 'update', id, props });
  }
  return ops;
};
