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

const px = (n: number) => `${Math.round(n * 100) / 100}px`;

/** Typography declarations for a text layer (also used to measure text). */
export function textDeclarations(node: DesignNode): CssDeclarations {
  return {
    color: node.fill ?? 'transparent',
    fontFamily: fontStack(node.fontFamily),
    fontSize: px(node.fontSize),
    fontWeight: node.fontWeight,
    lineHeight: node.lineHeight,
    letterSpacing: node.letterSpacing ? px(node.letterSpacing) : undefined,
    textAlign: node.textAlign,
    whiteSpace: node.textResize === 'auto-width' ? 'pre' : 'pre-wrap',
    overflowWrap: node.textResize === 'auto-width' ? undefined : 'break-word',
  };
}

/**
 * CSS for a layer positioned absolutely inside its parent. Assumes
 * `box-sizing: border-box`, which the canvas and exported code both set.
 */
export function nodeDeclarations(node: DesignNode): CssDeclarations {
  const css: CssDeclarations = {
    position: 'absolute',
    left: px(node.x),
    top: px(node.y),
    width: px(node.width),
    height: px(node.height),
  };
  if (node.rotation) css.transform = `rotate(${Math.round(node.rotation * 100) / 100}deg)`;
  if (node.opacity < 1) css.opacity = Math.round(node.opacity * 1000) / 1000;

  if (node.type === 'text') {
    Object.assign(css, textDeclarations(node));
    return css;
  }

  if (node.fill) css.background = node.fill;
  if (node.stroke && node.strokeWidth > 0) css.border = `${px(node.strokeWidth)} solid ${node.stroke}`;
  if (node.type === 'ellipse') css.borderRadius = '50%';
  else if (node.radius > 0) css.borderRadius = px(node.radius);
  if (node.type === 'frame' && node.clip) css.overflow = 'hidden';
  return css;
}
