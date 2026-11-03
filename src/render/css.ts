import { effectiveSizing, isWrapping } from '../model/layout';
import type { DesignNode } from '../model/types';

/**
 * The one mapping from design properties to CSS.
 *
 * The canvas renders layers as real DOM elements styled by this function,
 * and the code generators (Phase 3) will emit the same declarations. Because
 * both use the same mapping, what you see on the canvas is what the exported
 * code renders.
 */

export interface CssDeclarations {
  [property: string]: string | number | undefined;
}

export const FONT_FAMILIES = [
  { value: 'Inter', label: 'Inter', stack: 'Inter, system-ui, sans-serif' },
  { value: 'system-ui', label: 'System UI', stack: 'system-ui, sans-serif' },
  { value: 'Arial', label: 'Arial', stack: 'Arial, Helvetica, sans-serif' },
  { value: 'Georgia', label: 'Georgia', stack: 'Georgia, serif' },
  { value: 'Times New Roman', label: 'Times New Roman', stack: '"Times New Roman", Times, serif' },
  { value: 'Courier New', label: 'Courier New', stack: '"Courier New", Courier, monospace' },
] as const;

export function fontStack(family: string): string {
  const known = FONT_FAMILIES.find((f) => f.value === family);
  if (known) return known.stack;
  const quoted = /^[a-z-]+$/i.test(family) ? family : `"${family.replace(/"/g, '')}"`;
  return `${quoted}, sans-serif`;
}

export const px = (n: number) => `${Math.round(n * 100) / 100}px`;

/** Typography declarations for a text layer (also used to measure text). */
export function textDeclarations(node: DesignNode): CssDeclarations {
  // Auto-width text never wraps, unless an auto-layout parent gives it a width to fill.
  const wraps = node.textResize !== 'auto-width' || node.widthMode === 'fill';
  return {
    color: node.fill ?? 'transparent',
    fontFamily: fontStack(node.fontFamily),
    fontSize: px(node.fontSize),
    fontWeight: node.fontWeight,
    lineHeight: node.lineHeight,
    letterSpacing: node.letterSpacing ? px(node.letterSpacing) : undefined,
    textAlign: node.textAlign,
    whiteSpace: wraps ? 'pre-wrap' : 'pre',
    overflowWrap: wraps ? 'break-word' : undefined,
  };
}

/** A paint value: the fill colour, or a linear gradient from it to `gradientTo`. */
export function paintValue(node: DesignNode): string | undefined {
  if (node.gradientTo) {
    const angle = Math.round(node.gradientAngle * 100) / 100;
    return `linear-gradient(${angle}deg, ${node.fill ?? 'transparent'}, ${node.gradientTo})`;
  }
  return node.fill ?? undefined;
}

export function shadowValue(node: DesignNode): string | undefined {
  if (!node.shadowColor) return undefined;
  return `${px(node.shadowX)} ${px(node.shadowY)} ${px(node.shadowBlur)} ${px(node.shadowSpread)} ${node.shadowColor}`;
}

/** Everything about how a layer looks, independent of how it is positioned. */
export function appearanceDeclarations(node: DesignNode): CssDeclarations {
  const css: CssDeclarations = {};
  if (node.rotation) css.transform = `rotate(${Math.round(node.rotation * 100) / 100}deg)`;
  if (node.opacity < 1) css.opacity = Math.round(node.opacity * 1000) / 1000;

  if (node.type === 'text') {
    Object.assign(css, textDeclarations(node));
    return css;
  }

  const paint = node.type === 'image' ? (node.fill ?? undefined) : paintValue(node);
  if (paint) css.background = paint;
  if (node.stroke && node.strokeWidth > 0) css.border = `${px(node.strokeWidth)} solid ${node.stroke}`;
  if (node.type === 'ellipse') css.borderRadius = '50%';
  else if (node.radius > 0) css.borderRadius = px(node.radius);
  if ((node.type === 'frame' && node.clip) || node.type === 'image') css.overflow = 'hidden';
  const shadow = shadowValue(node);
  if (shadow) css.boxShadow = shadow;
  if (node.backdropBlur > 0) {
    css.backdropFilter = `blur(${px(node.backdropBlur)})`;
    css.WebkitBackdropFilter = css.backdropFilter;
  }
  return css;
}

/**
 * CSS for a layer positioned absolutely inside its parent: how the canvas
 * renders every layer, using positions the layout engine has already
 * resolved. Assumes `box-sizing: border-box`, which the canvas and exported
 * code both set.
 */
export function nodeDeclarations(node: DesignNode): CssDeclarations {
  return {
    position: 'absolute',
    left: px(node.x),
    top: px(node.y),
    width: px(node.width),
    height: px(node.height),
    ...appearanceDeclarations(node),
  };
}

const JUSTIFY = { start: 'flex-start', center: 'center', end: 'flex-end', 'space-between': 'space-between' } as const;
const ALIGN = { start: 'flex-start', center: 'center', end: 'flex-end' } as const;

/** Flexbox declarations for an auto-layout frame, as exported code expresses it. */
export function flexContainerDeclarations(node: DesignNode): CssDeclarations {
  if (node.type !== 'frame' || node.layout === 'none') return {};
  const pad = [node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft];
  const wraps = isWrapping(node);
  return {
    display: 'flex',
    flexDirection: node.layout,
    // Lines of a wrapping row sit together, aligned like the items within them.
    flexWrap: wraps ? 'wrap' : undefined,
    alignContent: wraps ? ALIGN[node.align] : undefined,
    gap: node.gap ? px(node.gap) : undefined,
    padding: pad.some(Boolean) ? pad.map(px).join(' ') : undefined,
    justifyContent: node.justify === 'start' ? undefined : JUSTIFY[node.justify],
    alignItems: ALIGN[node.align],
  };
}

/**
 * Size and placement declarations for a layer inside an auto-layout parent:
 * the flexbox equivalent of what the layout engine computes. Used by code
 * export and to check the engine against the browser.
 */
export function flexItemDeclarations(node: DesignNode, parent: DesignNode): CssDeclarations {
  if (node.positioning === 'absolute') {
    return { position: 'absolute', left: px(node.x), top: px(node.y), width: px(node.width), height: px(node.height) };
  }
  const row = parent.layout === 'row';
  const main = row ? 'width' : 'height';
  const cross = row ? 'height' : 'width';
  const css: CssDeclarations = { position: 'relative', flex: 'none' };
  const mainMode = effectiveSizing(node, main, parent);
  const crossMode = effectiveSizing(node, cross, parent);
  if (mainMode === 'fill') {
    css.flex = '1 1 0';
    css[row ? 'minWidth' : 'minHeight'] = 0;
  } else if (mainMode === 'fixed') {
    css[main] = px(node[main]);
  }
  if (crossMode === 'fill') css.alignSelf = 'stretch';
  else if (crossMode === 'fixed') css[cross] = px(node[cross]);
  // A wrapping row that hugs its width is as wide as all its children on one line. Without
  // this a column would squeeze it to its widest child and it would wrap.
  if (isWrapping(node) && node.widthMode === 'hug') css.width = 'max-content';
  return css;
}
