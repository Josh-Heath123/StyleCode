import { normalizeHexColor } from '../model/properties';
import type { DesignNode, NodeProps, NodeType } from '../model/types';
import type { Decl } from './screen';

/**
 * Code → design: a layer's CSS, edited in the code panel, turned back into
 * design properties. Only declarations StyleCode can represent are accepted;
 * anything else is reported instead of being silently dropped.
 */

/** Declarations the code panel lets you edit for a layer. */
export const EDITABLE = new Set([
  'left',
  'top',
  'flex-direction',
  'flex-wrap',
  'justify-content',
  'align-items',
  'gap',
  'padding',
  'width',
  'height',
  'transform',
  'opacity',
  'background',
  'border',
  'border-radius',
  'overflow',
  'box-shadow',
  'backdrop-filter',
  'object-fit',
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'text-align',
]);

/** Declarations StyleCode writes itself from the layout; editing them has no direct equivalent. */
const MANAGED: Record<string, string> = {
  position: 'Positioning comes from the layout: turn auto layout on or off, or tick "Ignore auto layout".',
  display: 'Use flex-direction to turn auto layout on.',
  flex: 'Use the Fill / Fixed / Hug sizing in the Design tab.',
  'align-self': 'Use the Fill / Fixed / Hug sizing in the Design tab.',
  'min-width': 'Sizes are set with width and height.',
  'min-height': 'Sizes are set with width and height.',
  'max-width': 'Sizes are set with width and height.',
  margin: 'Spacing comes from the parent’s gap and padding.',
  'white-space': 'Text wrapping follows the text layer’s width setting.',
  'overflow-wrap': 'Text wrapping follows the text layer’s width setting.',
  'align-content': 'Lines of a wrapping row follow align-items.',
  '-webkit-backdrop-filter': 'Use backdrop-filter.',
  'aspect-ratio': 'Sizes are set with width and height.',
};

/** Turns a colour value into `#rrggbb(aa)`, or null for transparent; undefined if it can't be read. */
export type ColorParser = (value: string) => string | null | undefined;

/** Reads hex colours and `transparent`. The app passes a parser that understands every CSS colour. */
export const hexColorParser: ColorParser = (value) => {
  const v = value.trim().toLowerCase();
  if (v === 'transparent') return null;
  return normalizeHexColor(v) ?? undefined;
};

/**
 * The declarations of a layer's rule that can be edited. A screen's own width
 * and height become the page's maximum width and minimum height in code, so
 * they are edited in the Design tab.
 */
export function editableDeclarations(decls: readonly Decl[], options: { screen?: boolean; type?: NodeType } = {}): Decl[] {
  return decls.filter(
    (d) =>
      EDITABLE.has(d.prop) &&
      !(options.screen && (d.prop === 'width' || d.prop === 'height')) &&
      // Only frames can choose whether to clip; other boxes always do.
      !(d.prop === 'overflow' && options.type && options.type !== 'frame'),
  );
}

/** Splits `a: b; c: d` into declarations, reporting lines it can't read. */
export function parseDeclarationText(text: string): { decls: Decl[]; errors: string[] } {
  const decls: Decl[] = [];
  const errors: string[] = [];
  const body = text.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const part of splitTopLevel(body, ';')) {
    const chunk = part.trim();
    if (!chunk) continue;
    const colon = chunk.indexOf(':');
    if (colon <= 0) {
      errors.push(`Couldn’t read “${chunk}”. Write it as property: value;`);
      continue;
    }
    const prop = chunk.slice(0, colon).trim().toLowerCase();
    const value = chunk
      .slice(colon + 1)
      .trim()
      .replace(/\s*!important$/i, '');
    if (!value) errors.push(`${prop} has no value.`);
    else decls.push({ prop, value });
  }
  return { decls, errors };
}

/** Splits on a separator that isn't inside parentheses. */
function splitTopLevel(text: string, separator: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === separator && depth === 0) {
      out.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out;
}

function tokens(value: string): string[] {
  return splitTopLevel(value.trim(), ' ')
    .map((t) => t.trim())
    .filter(Boolean);
}

/** A length in px (unitless 0 allowed). */
function length(value: string, fontSize = 16): number | undefined {
  const m = /^(-?\d*\.?\d+)(px|em|rem)?$/i.exec(value.trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!m[2]) return n === 0 ? 0 : undefined;
  if (m[2].toLowerCase() === 'px') return n;
  return n * (m[2].toLowerCase() === 'em' ? fontSize : 16);
}

const SIDE_ANGLES: Record<string, number> = { 'to top': 0, 'to right': 90, 'to bottom': 180, 'to left': 270 };

export type PropsResult = { ok: true; props: Partial<NodeProps> } | { ok: false; errors: string[] };

/**
 * The property changes that make a layer match the edited declarations.
 * `previous` is what the panel showed, so a removed declaration resets its
 * property (removing `border` removes the stroke).
 */
export function declarationsToProps(
  node: DesignNode,
  decls: readonly Decl[],
  previous: readonly Decl[],
  options: { parseColor?: ColorParser; inFlow?: boolean } = {},
): PropsResult {
  const parseColor = options.parseColor ?? hexColorParser;
  const props: Partial<NodeProps> = {};
  const errors: string[] = [];
  const isText = node.type === 'text';
  const isFrame = node.type === 'frame';
  const fontSize = node.fontSize;
  const fail = (message: string) => errors.push(message);
  const only = (prop: string, ok: boolean, what: string) => {
    if (!ok) fail(`${prop} only applies to ${what}.`);
    return ok;
  };
  const color = (prop: string, value: string): string | null | undefined => {
    const c = parseColor(value);
    if (c === undefined) fail(`${prop}: “${value}” isn’t a colour StyleCode can read.`);
    return c;
  };
  const len = (prop: string, value: string, min = -Infinity): number | undefined => {
    const n = length(value, fontSize);
    if (n === undefined || n < min) {
      fail(`${prop}: “${value}” should be a length in px${min === 0 ? ' (0 or more)' : ''}.`);
      return undefined;
    }
    return n;
  };

  const seen = new Set<string>();
  const before = new Map(previous.map((d) => [d.prop, d.value.trim()]));
  for (const { prop, value } of decls) {
    const v = value.trim();
    const lower = v.toLowerCase();
    seen.add(prop);
    // Only what was changed is applied: re-applying a size shown in px would fix a size that hugs.
    if (before.get(prop) === v) continue;
    if (!EDITABLE.has(prop)) {
      fail(MANAGED[prop] ? `${prop} is set by StyleCode. ${MANAGED[prop]}` : `${prop} isn’t supported yet.`);
      continue;
    }
    switch (prop) {
      case 'left':
      case 'top': {
        if (options.inFlow) {
          fail(`${prop}: this layer is placed by auto layout. Tick "Ignore auto layout" to position it yourself.`);
          break;
        }
        const n = len(prop, v);
        if (n !== undefined) props[prop === 'left' ? 'x' : 'y'] = n;
        break;
      }
      case 'width':
      case 'height': {
        const axis = prop;
        const mode = axis === 'width' ? 'widthMode' : 'heightMode';
        if (lower === 'auto' || lower === 'fit-content' || lower === 'max-content') {
          if (isFrame && node.layout !== 'none') props[mode] = 'hug';
          else if (isText)
            props.textResize = axis === 'width' ? 'auto-width' : node.textResize === 'fixed' ? 'auto-height' : node.textResize;
          else fail(`${prop}: only auto-layout frames and text can size to their content.`);
          break;
        }
        const n = len(prop, v, 0);
        if (n === undefined) break;
        props[axis] = n;
        props[mode] = 'fixed';
        if (isText) {
          if (axis === 'width' && node.textResize === 'auto-width') props.textResize = 'auto-height';
          if (axis === 'height') props.textResize = 'fixed';
        }
        break;
      }
      case 'transform': {
        if (lower === 'none') props.rotation = 0;
        else {
          const m = /^rotate\(\s*(-?\d*\.?\d+)(deg|turn)?\s*\)$/i.exec(v);
          if (m) props.rotation = Number(m[1]) * (m[2]?.toLowerCase() === 'turn' ? 360 : 1);
          else fail('transform: only rotate(…deg) is supported.');
        }
        break;
      }
      case 'opacity': {
        const m = /^(\d*\.?\d+)(%)?$/.exec(v);
        const n = m ? Number(m[1]) / (m[2] ? 100 : 1) : NaN;
        if (Number.isFinite(n) && n >= 0 && n <= 1) props.opacity = n;
        else fail('opacity should be between 0 and 1.');
        break;
      }
      case 'background': {
        if (!only(prop, !isText, 'shapes and frames (use color for text)')) break;
        if (lower === 'none' || lower === 'transparent') {
          props.fill = null;
          if (node.type !== 'image') props.gradientTo = null;
          break;
        }
        const gradient = /^linear-gradient\((.*)\)$/i.exec(v);
        if (gradient) {
          if (node.type === 'image') {
            fail('background: images can only have a plain colour behind them.');
            break;
          }
          const parts = splitTopLevel(gradient[1], ',').map((p) => p.trim());
          let angle = 180;
          if (/deg$/i.test(parts[0]) || SIDE_ANGLES[parts[0].toLowerCase()] !== undefined) {
            const first = parts.shift()!.toLowerCase();
            angle = SIDE_ANGLES[first] ?? Number(first.replace(/deg$/, ''));
          }
          if (parts.length !== 2 || !Number.isFinite(angle)) {
            fail('background: gradients need two colours, e.g. linear-gradient(180deg, #2f7bff, #7b5cff).');
            break;
          }
          const from = color(prop, parts[0]);
          const to = color(prop, parts[1]);
          if (from === undefined || to === undefined) break;
          props.fill = from;
          props.gradientTo = to ?? '#00000000';
          props.gradientAngle = ((angle % 360) + 360) % 360;
          break;
        }
        const c = color(prop, v);
        if (c !== undefined) {
          props.fill = c;
          if (node.type !== 'image') props.gradientTo = null;
        }
        break;
      }
      case 'color': {
        if (!only(prop, isText, 'text (use background for shapes)')) break;
        const c = color(prop, v);
        if (c !== undefined) props.fill = c;
        break;
      }
      case 'border': {
        if (!only(prop, !isText, 'shapes, frames and images')) break;
        if (lower === 'none' || lower === '0') {
          props.stroke = null;
          break;
        }
        let width: number | undefined;
        let stroke: string | null | undefined;
        let style = 'solid';
        for (const t of tokens(v)) {
          const n = length(t);
          if (n !== undefined) width = n;
          else if (/^(solid|dashed|dotted|double|groove|ridge|inset|outset|none|hidden)$/i.test(t)) style = t.toLowerCase();
          else stroke = color(prop, t);
        }
        if (style !== 'solid') fail('border: only solid borders are supported.');
        else if (stroke === undefined && !errors.length) fail('border needs a colour, e.g. 1px solid #e1e4ea.');
        else if (stroke !== undefined) {
          props.stroke = stroke;
          props.strokeWidth = width ?? 1;
        }
        break;
      }
      case 'border-radius': {
        if (node.type === 'ellipse') {
          if (lower !== '50%') fail('border-radius: ellipses are always round.');
          break;
        }
        if (!only(prop, node.type === 'frame' || node.type === 'rect' || node.type === 'image', 'frames, rectangles and images'))
          break;
        if (tokens(v).length > 1) {
          fail('border-radius: one radius for all corners (per-corner radius isn’t supported yet).');
          break;
        }
        const n = len(prop, v, 0);
        if (n !== undefined) props.radius = n;
        break;
      }
      case 'overflow': {
        if (!only(prop, isFrame, 'frames')) break;
        if (/^(hidden|clip)$/.test(lower)) props.clip = true;
        else if (/^(visible|auto)$/.test(lower)) props.clip = false;
        else fail('overflow should be hidden or visible.');
        break;
      }
      case 'box-shadow': {
        if (!only(prop, !isText, 'shapes, frames and images')) break;
        if (lower === 'none') {
          props.shadowColor = null;
          break;
        }
        if (splitTopLevel(v, ',').length > 1 || /\binset\b/i.test(v)) {
          fail('box-shadow: one outer shadow is supported.');
          break;
        }
        const lengths: number[] = [];
        let shadow: string | null | undefined;
        for (const t of tokens(v)) {
          const n = length(t);
          if (n !== undefined) lengths.push(n);
          else shadow = color(prop, t);
        }
        if (lengths.length < 2 || lengths.length > 4 || shadow === undefined) {
          if (!errors.length) fail('box-shadow should look like 0px 8px 24px 0px #0000001a.');
          break;
        }
        props.shadowX = lengths[0];
        props.shadowY = lengths[1];
        props.shadowBlur = Math.max(0, lengths[2] ?? 0);
        props.shadowSpread = lengths[3] ?? 0;
        props.shadowColor = shadow ?? '#00000000';
        break;
      }
      case 'backdrop-filter': {
        if (!only(prop, isFrame || node.type === 'rect' || node.type === 'ellipse', 'frames and shapes')) break;
        if (lower === 'none') props.backdropBlur = 0;
        else {
          const m = /^blur\(\s*([\d.]+)px\s*\)$/i.exec(v);
          if (m) props.backdropBlur = Number(m[1]);
          else fail('backdrop-filter: only blur(…px) is supported.');
        }
        break;
      }
      case 'object-fit': {
        if (!only(prop, node.type === 'image', 'images')) break;
        if (lower === 'cover' || lower === 'contain' || lower === 'fill') props.fit = lower;
        else fail('object-fit should be cover, contain or fill.');
        break;
      }
      case 'font-family': {
        if (!only(prop, isText, 'text')) break;
        const first = splitTopLevel(v, ',')[0]
          .trim()
          .replace(/^['"]|['"]$/g, '');
        if (first) props.fontFamily = first;
        else fail('font-family needs a font name.');
        break;
      }
      case 'font-size': {
        if (!only(prop, isText, 'text')) break;
        const n = len(prop, v, 1);
        if (n !== undefined) props.fontSize = n;
        break;
      }
      case 'font-weight': {
        if (!only(prop, isText, 'text')) break;
        const n = lower === 'normal' ? 400 : lower === 'bold' ? 700 : Number(v);
        if (Number.isInteger(n) && n >= 100 && n <= 900) props.fontWeight = n;
        else fail('font-weight should be a number from 100 to 900.');
        break;
      }
      case 'line-height': {
        if (!only(prop, isText, 'text')) break;
        let n: number | undefined;
        if (lower === 'normal') n = 1.2;
        else if (/^\d*\.?\d+$/.test(v)) n = Number(v);
        else if (/%$/.test(v)) n = Number(v.slice(0, -1)) / 100;
        else {
          const px = length(v, props.fontSize ?? fontSize);
          if (px !== undefined) n = px / (props.fontSize ?? fontSize);
        }
        if (n !== undefined && Number.isFinite(n) && n >= 0.5 && n <= 5) props.lineHeight = Math.round(n * 1000) / 1000;
        else fail('line-height should be a multiple of the font size between 0.5 and 5, like 1.4.');
        break;
      }
      case 'letter-spacing': {
        if (!only(prop, isText, 'text')) break;
        if (lower === 'normal') props.letterSpacing = 0;
        else {
          const n = len(prop, v);
          if (n !== undefined) props.letterSpacing = n;
        }
        break;
      }
      case 'text-align': {
        if (!only(prop, isText, 'text')) break;
        const map: Record<string, NodeProps['textAlign']> = {
          left: 'left',
          start: 'left',
          center: 'center',
          right: 'right',
          end: 'right',
        };
        if (map[lower]) props.textAlign = map[lower];
        else fail('text-align should be left, center or right.');
        break;
      }
      case 'flex-direction': {
        if (!only(prop, isFrame, 'frames')) break;
        if (lower === 'row' || lower === 'column') props.layout = lower;
        else fail('flex-direction should be row or column.');
        break;
      }
      case 'flex-wrap': {
        if (!only(prop, isFrame, 'frames')) break;
        if (lower === 'wrap' || lower === 'nowrap') props.wrap = lower === 'wrap';
        else fail('flex-wrap should be wrap or nowrap.');
        break;
      }
      case 'justify-content': {
        if (!only(prop, isFrame, 'frames')) break;
        const map: Record<string, NodeProps['justify']> = {
          'flex-start': 'start',
          start: 'start',
          normal: 'start',
          center: 'center',
          'flex-end': 'end',
          end: 'end',
          'space-between': 'space-between',
        };
        if (map[lower]) props.justify = map[lower];
        else fail('justify-content should be flex-start, center, flex-end or space-between.');
        break;
      }
      case 'align-items': {
        if (!only(prop, isFrame, 'frames')) break;
        const map: Record<string, NodeProps['align']> = {
          'flex-start': 'start',
          start: 'start',
          normal: 'start',
          center: 'center',
          'flex-end': 'end',
          end: 'end',
        };
        if (map[lower]) props.align = map[lower];
        else fail('align-items should be flex-start, center or flex-end.');
        break;
      }
      case 'gap': {
        if (!only(prop, isFrame, 'frames')) break;
        const parts = tokens(v);
        if (parts.length > 1 && parts[0] !== parts[1]) {
          fail('gap: one value (the same between items and between lines).');
          break;
        }
        const n = len(prop, parts[0], 0);
        if (n !== undefined) props.gap = n;
        break;
      }
      case 'padding': {
        if (!only(prop, isFrame, 'frames')) break;
        const values = tokens(v).map((t) => length(t));
        if (values.length < 1 || values.length > 4 || values.some((n) => n === undefined || n < 0)) {
          fail('padding should be one to four lengths in px.');
          break;
        }
        const [t, r = t, b = t, l = r] = values as number[];
        props.paddingTop = t;
        props.paddingRight = r;
        props.paddingBottom = b;
        props.paddingLeft = l;
        break;
      }
    }
  }

  // Removed declarations reset what they described.
  const removed = previous.filter((d) => !seen.has(d.prop)).map((d) => d.prop);
  for (const prop of removed) {
    switch (prop) {
      case 'background':
        props.fill = null;
        if (node.type !== 'image') props.gradientTo = null;
        break;
      case 'border':
        props.stroke = null;
        break;
      case 'border-radius':
        if (node.type !== 'ellipse') props.radius = 0;
        break;
      case 'overflow':
        if (isFrame) props.clip = false;
        break;
      case 'box-shadow':
        props.shadowColor = null;
        break;
      case 'backdrop-filter':
        props.backdropBlur = 0;
        break;
      case 'opacity':
        props.opacity = 1;
        break;
      case 'transform':
        props.rotation = 0;
        break;
      case 'letter-spacing':
        props.letterSpacing = 0;
        break;
      case 'gap':
        props.gap = 0;
        break;
      case 'padding':
        props.paddingTop = props.paddingRight = props.paddingBottom = props.paddingLeft = 0;
        break;
      case 'flex-wrap':
        props.wrap = false;
        break;
      case 'justify-content':
        props.justify = 'start';
        break;
    }
  }
  if (!seen.has('text-align') && isText && node.textAlign !== 'left') props.textAlign = 'left';

  return errors.length ? { ok: false, errors } : { ok: true, props };
}
