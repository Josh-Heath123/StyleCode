import { effectiveSizing, isGrid, isWrapping } from '../model/layout';
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

/** The space between a note's edge and its text. */
export const NOTE_PADDING = { x: 12, y: 10 } as const;
/** Colours offered for notes; the first is the default. */
export const NOTE_COLORS = ['#ffd8a8', '#fff3bf', '#d0ebff', '#d3f9d8', '#ffc9c9'] as const;

/** A note on the canvas: a sticky note, never part of exported code. */
function noteDeclarations(node: DesignNode): CssDeclarations {
  return {
    background: node.fill ?? NOTE_COLORS[0],
    color: '#2b1d0e',
    fontFamily: fontStack(node.fontFamily),
    fontSize: px(node.fontSize),
    lineHeight: node.lineHeight,
    padding: `${px(NOTE_PADDING.y)} ${px(NOTE_PADDING.x)}`,
    borderRadius: '4px',
    boxShadow: '0 6px 18px rgba(0, 0, 0, 0.35)',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
    overflow: 'hidden',
  };
}

/** `border-radius`: one value, or four (top-left, top-right, bottom-right, bottom-left). */
export function radiusValue(node: DesignNode): string | undefined {
  if (node.independentCorners) {
    const corners = [node.radiusTopLeft, node.radiusTopRight, node.radiusBottomRight, node.radiusBottomLeft];
    if (corners.every((r) => r === 0)) return undefined;
    return corners.every((r) => r === corners[0]) ? px(corners[0]) : corners.map(px).join(' ');
  }
  return node.radius > 0 ? px(node.radius) : undefined;
}

/** Everything about how a layer looks, independent of how it is positioned. */
export function appearanceDeclarations(node: DesignNode): CssDeclarations {
  const css: CssDeclarations = {};
  if (node.type === 'note') return noteDeclarations(node);
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
  else css.borderRadius = radiusValue(node);
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
/** In a grid, layers that don't fill their cell are placed in it like this (space-between has no meaning there). */
const GRID_PLACE = { start: 'start', center: 'center', end: 'end', 'space-between': 'start' } as const;

/** The track list of a grid with `columns` equal columns. */
export const gridColumns = (columns: number) => `repeat(${columns}, minmax(0, 1fr))`;

/** Grid declarations for a frame laid out in columns. */
function gridContainerDeclarations(node: DesignNode): CssDeclarations {
  const pad = [node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft];
  return {
    display: 'grid',
    gridTemplateColumns: gridColumns(node.columns),
    // Rows are as tall as their content: never stretched by a taller grid, never squeezed by a shorter one.
    gridAutoRows: 'max-content',
    alignContent: 'start',
    gap: node.gap ? px(node.gap) : undefined,
    padding: pad.some(Boolean) ? pad.map(px).join(' ') : undefined,
    justifyItems: GRID_PLACE[node.justify],
    alignItems: GRID_PLACE[node.align],
  };
}

/** Limits on a layer's size (`min-width`…), for layers that auto layout sizes. */
export function limitDeclarations(node: DesignNode): CssDeclarations {
  return {
    minWidth: node.minWidth ? px(node.minWidth) : undefined,
    maxWidth: node.maxWidth ? px(node.maxWidth) : undefined,
    minHeight: node.minHeight ? px(node.minHeight) : undefined,
    maxHeight: node.maxHeight ? px(node.maxHeight) : undefined,
  };
}

/** Flexbox (or grid) declarations for an auto-layout frame, as exported code expresses it. */
export function flexContainerDeclarations(node: DesignNode): CssDeclarations {
  if (node.type !== 'frame' || node.layout === 'none') return {};
  if (isGrid(node)) return gridContainerDeclarations(node);
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
    return {
      position: 'absolute',
      left: px(node.x),
      top: px(node.y),
      width: px(node.width),
      height: px(node.height),
      ...limitDeclarations(node),
    };
  }
  if (isGrid(parent)) return gridItemDeclarations(node, parent);
  const row = parent.layout === 'row';
  const main = row ? 'width' : 'height';
  const cross = row ? 'height' : 'width';
  const css: CssDeclarations = { position: 'relative', flex: 'none' };
  const mainMode = effectiveSizing(node, main, parent);
  const crossMode = effectiveSizing(node, cross, parent);
  Object.assign(css, limitDeclarations(node));
  if (mainMode === 'fill') {
    css.flex = '1 1 0';
    // Without a minimum of its own, a filling layer may shrink to nothing, as the layout engine allows.
    const key = row ? 'minWidth' : 'minHeight';
    if (!css[key]) css[key] = 0;
  } else if (mainMode === 'fixed') {
    css[main] = px(node[main]);
  }
  if (crossMode === 'fill') css.alignSelf = 'stretch';
  else if (crossMode === 'fixed') css[cross] = px(node[cross]);
  if (hugsMaxContent(node)) css.width = 'max-content';
  return css;
}

/**
 * A wrapping row or a grid that hugs its width is as wide as its content on
 * one line (or in full-width columns). Without `max-content`, a column or a
 * grid cell would squeeze it to fit and its content would wrap.
 */
function hugsMaxContent(node: DesignNode): boolean {
  return (isWrapping(node) || isGrid(node)) && node.widthMode === 'hug';
}

/** A layer in a grid: its column span, and whether it fills its cell or keeps its own size. */
function gridItemDeclarations(node: DesignNode, parent: DesignNode): CssDeclarations {
  const css: CssDeclarations = { position: 'relative' };
  const span = Math.min(parent.columns, Math.max(1, node.columnSpan));
  if (span > 1) css.gridColumn = `span ${span}`;
  const widthMode = effectiveSizing(node, 'width', parent);
  const heightMode = effectiveSizing(node, 'height', parent);
  if (widthMode === 'fill') {
    css.justifySelf = 'stretch';
  } else if (widthMode === 'fixed') {
    css.width = px(node.width);
  }
  if (heightMode === 'fill') css.alignSelf = 'stretch';
  else if (heightMode === 'fixed') css.height = px(node.height);
  Object.assign(css, limitDeclarations(node));
  if (hugsMaxContent(node)) css.width = 'max-content';
  return css;
}
