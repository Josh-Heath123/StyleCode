import { ROLES, type NodeProps, type NodeType, type PropKey } from './types';

/**
 * The property registry.
 *
 * One table describes every editable property: its value type, its valid
 * range and which node types it applies to. Validation of operations (from
 * the user or from an AI model) goes through `coerceProp`, so a property can
 * never hold a value the renderer or code generator does not understand.
 */

export type PropSpec =
  | { kind: 'number'; min?: number; max?: number; integer?: boolean; wrapDegrees?: boolean }
  | { kind: 'boolean' }
  | { kind: 'string'; maxLength: number; pattern?: RegExp }
  | { kind: 'color'; nullable: boolean }
  | { kind: 'enum'; values: readonly string[] };

export interface PropDef {
  spec: PropSpec;
  /** Node types this property is meaningful for. */
  appliesTo: readonly NodeType[] | 'all';
  /** Plain description; reused when describing the schema to an AI model. */
  description: string;
}

const SHAPES: readonly NodeType[] = ['frame', 'rect', 'ellipse', 'text', 'image'];
const BOXES: readonly NodeType[] = ['frame', 'rect', 'ellipse', 'image'];
const PAINTED: readonly NodeType[] = ['frame', 'rect', 'ellipse'];
const TEXT: readonly NodeType[] = ['text'];
const FRAME: readonly NodeType[] = ['frame'];
const PADDING = { kind: 'number', min: 0, max: 10_000 } as const;
const OFFSET = { kind: 'number', min: -10_000, max: 10_000 } as const;

export const PROPERTY_DEFS: Readonly<Record<PropKey, PropDef>> = {
  name: { spec: { kind: 'string', maxLength: 200 }, appliesTo: 'all', description: 'Layer name' },
  visible: { spec: { kind: 'boolean' }, appliesTo: SHAPES, description: 'Whether the layer is shown' },
  locked: { spec: { kind: 'boolean' }, appliesTo: SHAPES, description: 'Locked layers cannot be selected on the canvas' },

  x: { spec: { kind: 'number', min: -1e6, max: 1e6 }, appliesTo: SHAPES, description: 'Left offset from the parent, in px' },
  y: { spec: { kind: 'number', min: -1e6, max: 1e6 }, appliesTo: SHAPES, description: 'Top offset from the parent, in px' },
  // Zero is allowed: auto-layout can squeeze a filling layer to nothing, as CSS does.
  width: { spec: { kind: 'number', min: 0, max: 1e5 }, appliesTo: SHAPES, description: 'Width in px' },
  height: { spec: { kind: 'number', min: 0, max: 1e5 }, appliesTo: SHAPES, description: 'Height in px' },
  rotation: {
    spec: { kind: 'number', wrapDegrees: true },
    appliesTo: SHAPES,
    description: 'Rotation in degrees around the centre',
  },

  opacity: { spec: { kind: 'number', min: 0, max: 1 }, appliesTo: SHAPES, description: 'Layer opacity from 0 to 1' },
  fill: {
    spec: { kind: 'color', nullable: true },
    appliesTo: 'all',
    description: 'Background colour (text colour for text layers), hex, or null',
  },
  stroke: { spec: { kind: 'color', nullable: true }, appliesTo: BOXES, description: 'Border colour, hex, or null for none' },
  strokeWidth: { spec: { kind: 'number', min: 0, max: 1000 }, appliesTo: BOXES, description: 'Border width in px' },
  radius: {
    spec: { kind: 'number', min: 0, max: 1e5 },
    appliesTo: ['frame', 'rect', 'image'],
    description: 'Corner radius in px',
  },
  clip: { spec: { kind: 'boolean' }, appliesTo: ['frame'], description: 'Clip children to the frame bounds' },

  text: { spec: { kind: 'string', maxLength: 100_000 }, appliesTo: TEXT, description: 'Text content' },
  fontFamily: { spec: { kind: 'string', maxLength: 200 }, appliesTo: TEXT, description: 'CSS font family name' },
  fontSize: { spec: { kind: 'number', min: 1, max: 1000 }, appliesTo: TEXT, description: 'Font size in px' },
  fontWeight: {
    spec: { kind: 'number', min: 100, max: 900, integer: true },
    appliesTo: TEXT,
    description: 'Font weight, 100 to 900',
  },
  lineHeight: {
    spec: { kind: 'number', min: 0.5, max: 5 },
    appliesTo: TEXT,
    description: 'Line height as a multiple of the font size',
  },
  letterSpacing: { spec: { kind: 'number', min: -100, max: 1000 }, appliesTo: TEXT, description: 'Letter spacing in px' },
  textAlign: {
    spec: { kind: 'enum', values: ['left', 'center', 'right'] },
    appliesTo: TEXT,
    description: 'Horizontal text alignment',
  },
  textResize: {
    spec: { kind: 'enum', values: ['auto-width', 'auto-height', 'fixed'] },
    appliesTo: TEXT,
    description: 'auto-width grows with the text, auto-height wraps at a fixed width, fixed keeps both dimensions',
  },

  layout: {
    spec: { kind: 'enum', values: ['none', 'row', 'column'] },
    appliesTo: FRAME,
    description: 'Auto-layout direction: row or column arranges children automatically (flexbox); none positions them freely',
  },
  gap: { spec: PADDING, appliesTo: FRAME, description: 'Space between auto-layout children in px' },
  paddingTop: { spec: PADDING, appliesTo: FRAME, description: 'Auto-layout padding at the top in px' },
  paddingRight: { spec: PADDING, appliesTo: FRAME, description: 'Auto-layout padding on the right in px' },
  paddingBottom: { spec: PADDING, appliesTo: FRAME, description: 'Auto-layout padding at the bottom in px' },
  paddingLeft: { spec: PADDING, appliesTo: FRAME, description: 'Auto-layout padding on the left in px' },
  justify: {
    spec: { kind: 'enum', values: ['start', 'center', 'end', 'space-between'] },
    appliesTo: FRAME,
    description: 'Distribution of auto-layout children along the layout direction',
  },
  align: {
    spec: { kind: 'enum', values: ['start', 'center', 'end'] },
    appliesTo: FRAME,
    description: 'Alignment of auto-layout children across the layout direction',
  },
  wrap: {
    spec: { kind: 'boolean' },
    appliesTo: FRAME,
    description: 'Rows only: children that do not fit move onto a new line, with the same gap between lines',
  },
  widthMode: {
    spec: { kind: 'enum', values: ['fixed', 'hug', 'fill'] },
    appliesTo: SHAPES,
    description:
      'fixed keeps the width; hug fits an auto-layout frame to its content; fill takes the space left in an auto-layout parent',
  },
  heightMode: {
    spec: { kind: 'enum', values: ['fixed', 'hug', 'fill'] },
    appliesTo: SHAPES,
    description:
      'fixed keeps the height; hug fits an auto-layout frame to its content; fill takes the space left in an auto-layout parent',
  },
  positioning: {
    spec: { kind: 'enum', values: ['auto', 'absolute'] },
    appliesTo: SHAPES,
    description: 'Inside an auto-layout frame, absolute keeps the layer at its x/y instead of in the flow',
  },
  role: {
    spec: { kind: 'enum', values: ROLES },
    appliesTo: SHAPES,
    description: 'What the layer is: button, nav, heading, card… auto infers it from the layer type',
  },

  shadowColor: { spec: { kind: 'color', nullable: true }, appliesTo: BOXES, description: 'Drop shadow colour, or null for none' },
  shadowX: { spec: OFFSET, appliesTo: BOXES, description: 'Shadow horizontal offset in px' },
  shadowY: { spec: OFFSET, appliesTo: BOXES, description: 'Shadow vertical offset in px' },
  shadowBlur: { spec: { kind: 'number', min: 0, max: 1000 }, appliesTo: BOXES, description: 'Shadow blur radius in px' },
  shadowSpread: { spec: OFFSET, appliesTo: BOXES, description: 'Shadow spread in px' },
  backdropBlur: {
    spec: { kind: 'number', min: 0, max: 200 },
    appliesTo: PAINTED,
    description: 'Blur of whatever is behind the layer in px (frosted glass); 0 for none',
  },
  gradientTo: {
    spec: { kind: 'color', nullable: true },
    appliesTo: PAINTED,
    description: 'End colour of a linear gradient starting from fill, or null for a solid fill',
  },
  gradientAngle: {
    spec: { kind: 'number', min: 0, max: 360 },
    appliesTo: PAINTED,
    description: 'Gradient direction in degrees (180 = top to bottom)',
  },

  src: {
    spec: { kind: 'string', maxLength: 100, pattern: /^(asset_[a-z0-9]{8,64})?$/ },
    appliesTo: ['image'],
    description: 'Image asset id, or empty for a placeholder',
  },
  fit: {
    spec: { kind: 'enum', values: ['cover', 'contain', 'fill'] },
    appliesTo: ['image'],
    description: 'How the image fills its box',
  },
};

export const PROP_KEYS = Object.keys(PROPERTY_DEFS) as PropKey[];

export function isPropKey(key: string): key is PropKey {
  return Object.prototype.hasOwnProperty.call(PROPERTY_DEFS, key);
}

export function propAppliesTo(key: PropKey, type: NodeType): boolean {
  const applies = PROPERTY_DEFS[key].appliesTo;
  return applies === 'all' || applies.includes(type);
}

export type CoerceResult<T> = { ok: true; value: T } | { ok: false; error: string };

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Normalises a hex colour to lowercase `#rrggbb` or `#rrggbbaa`. Returns null if invalid. */
export function normalizeHexColor(input: string): string | null {
  const value = input.trim();
  if (!HEX_COLOR.test(value)) return null;
  let hex = value.slice(1).toLowerCase();
  if (hex.length === 3 || hex.length === 4) {
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('');
  }
  // Fully opaque 8-digit colours collapse to 6 digits so equal colours compare equal.
  if (hex.length === 8 && hex.endsWith('ff')) hex = hex.slice(0, 6);
  return `#${hex}`;
}

/** Wraps an angle in degrees into (-180, 180]. */
export function wrapDegrees(deg: number): number {
  let d = deg % 360;
  if (d <= -180) d += 360;
  if (d > 180) d -= 360;
  // Avoid -0 so that equality checks and serialisation stay clean.
  return d === 0 ? 0 : d;
}

/**
 * Validates and normalises a single property value.
 * Numbers are clamped into range; anything with the wrong type is rejected.
 */
export function coerceProp<K extends PropKey>(key: K, value: unknown): CoerceResult<NodeProps[K]> {
  const def = PROPERTY_DEFS[key];
  if (!def) return { ok: false, error: `Unknown property "${String(key)}"` };
  const spec = def.spec;
  switch (spec.kind) {
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return { ok: false, error: `${key} must be a finite number` };
      }
      let n = value;
      if (spec.wrapDegrees) n = wrapDegrees(n);
      if (spec.integer) n = Math.round(n);
      if (spec.min !== undefined) n = Math.max(spec.min, n);
      if (spec.max !== undefined) n = Math.min(spec.max, n);
      return { ok: true, value: n as NodeProps[K] };
    }
    case 'boolean':
      if (typeof value !== 'boolean') return { ok: false, error: `${key} must be true or false` };
      return { ok: true, value: value as NodeProps[K] };
    case 'string':
      if (typeof value !== 'string') return { ok: false, error: `${key} must be a string` };
      if (value.length > spec.maxLength) return { ok: false, error: `${key} is longer than ${spec.maxLength} characters` };
      if (spec.pattern && !spec.pattern.test(value)) return { ok: false, error: `${key} has an invalid format` };
      return { ok: true, value: value as NodeProps[K] };
    case 'color': {
      if (value === null) {
        return spec.nullable ? { ok: true, value: null as NodeProps[K] } : { ok: false, error: `${key} cannot be empty` };
      }
      if (typeof value !== 'string') return { ok: false, error: `${key} must be a hex colour` };
      const hex = normalizeHexColor(value);
      if (!hex) return { ok: false, error: `${key} must be a hex colour like #2f7bff, got "${value}"` };
      return { ok: true, value: hex as NodeProps[K] };
    }
    case 'enum':
      if (typeof value !== 'string' || !spec.values.includes(value)) {
        return { ok: false, error: `${key} must be one of ${spec.values.join(', ')}` };
      }
      return { ok: true, value: value as NodeProps[K] };
  }
}
