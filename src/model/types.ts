/**
 * The design document model.
 *
 * This is the single source of truth for everything in StyleCode: the canvas
 * renders it, the panels edit it, undo/redo replays operations against it, the
 * AI proposes operations against it and the code generators compile it.
 *
 * It is deliberately framework-independent: nothing in `src/model` may import
 * React or touch the DOM.
 */

export type NodeType = 'page' | 'frame' | 'rect' | 'ellipse' | 'text' | 'image';

/** Node types that can contain children. */
export const CONTAINER_TYPES: ReadonlySet<NodeType> = new Set<NodeType>(['page', 'frame']);

/** Node types a user (or the AI) may create. The page is created with the document. */
export const CREATABLE_TYPES: readonly NodeType[] = ['frame', 'rect', 'ellipse', 'text', 'image'];

export type TextAlign = 'left' | 'center' | 'right';

/**
 * How a text node sizes itself.
 * - auto-width: the box grows to fit the text on one line per paragraph
 * - auto-height: width is fixed, text wraps and the height grows to fit
 * - fixed: both dimensions are fixed; overflowing text is visible
 */
export type TextResize = 'auto-width' | 'auto-height' | 'fixed';

/** Auto-layout direction of a frame; 'none' means children are positioned freely. */
export type LayoutDirection = 'none' | 'row' | 'column';

/** Distribution of children along the layout direction (CSS justify-content). */
export type Justify = 'start' | 'center' | 'end' | 'space-between';

/** Alignment of children across the layout direction (CSS align-items). */
export type Align = 'start' | 'center' | 'end';

/**
 * How a dimension is decided.
 * - fixed: the stored size
 * - hug: fit the content (auto-layout frames)
 * - fill: take the space available in an auto-layout parent
 */
export type SizingMode = 'fixed' | 'hug' | 'fill';

/** Whether a child of an auto-layout frame takes part in the flow or keeps its own position. */
export type Positioning = 'auto' | 'absolute';

/** What a layer is, semantically. Drives HTML tags in exported code and context for the AI. */
export const ROLES = [
  'auto',
  'button',
  'link',
  'nav',
  'header',
  'footer',
  'section',
  'card',
  'heading',
  'paragraph',
  'label',
  'input',
  'image',
  'list',
  'list-item',
] as const;
export type Role = (typeof ROLES)[number];

/** How an image fills its box (CSS object-fit). */
export type ImageFit = 'cover' | 'contain' | 'fill';

/**
 * Every editable property of a node. Each key is described in the property
 * registry (`properties.ts`), which drives validation, the properties panel,
 * the AI operation schema and CSS generation.
 *
 * Coordinates follow the CSS box model: `x`/`y` are the offset of the node's
 * border box from its parent's padding box (i.e. inside the parent's stroke),
 * and rotation is applied around the node's centre.
 */
export interface NodeProps {
  name: string;
  visible: boolean;
  locked: boolean;

  x: number;
  y: number;
  width: number;
  height: number;
  /** Degrees, normalised to (-180, 180]. */
  rotation: number;

  /** 0..1 */
  opacity: number;
  /** `#rrggbb` or `#rrggbbaa`, or null for no fill. For text this is the text colour. */
  fill: string | null;
  /** `#rrggbb` or `#rrggbbaa`, or null for no stroke. */
  stroke: string | null;
  strokeWidth: number;
  radius: number;
  /** Frames only: clip children to the frame's bounds. */
  clip: boolean;

  /** Text only. */
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  /** Unitless multiplier of the font size. */
  lineHeight: number;
  /** Pixels. */
  letterSpacing: number;
  textAlign: TextAlign;
  textResize: TextResize;

  /** Frames only: auto-layout (CSS flexbox). */
  layout: LayoutDirection;
  gap: number;
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  justify: Justify;
  align: Align;
  /** Rows only: children that don't fit move onto a new line (CSS flex-wrap). */
  wrap: boolean;

  /** Sizing within auto-layout. */
  widthMode: SizingMode;
  heightMode: SizingMode;
  positioning: Positioning;

  role: Role;

  /** Drop shadow; no shadow when the colour is null. */
  shadowColor: string | null;
  shadowX: number;
  shadowY: number;
  shadowBlur: number;
  shadowSpread: number;
  /** Background blur behind the layer, in px (frosted glass). */
  backdropBlur: number;
  /** Second colour of a linear gradient from `fill`; no gradient when null. */
  gradientTo: string | null;
  /** Gradient direction in degrees, CSS convention (180 = top to bottom). */
  gradientAngle: number;

  /** Images only: local asset id, or empty for a placeholder. */
  src: string;
  fit: ImageFit;
}

export type PropKey = keyof NodeProps;

export interface DesignNode extends NodeProps {
  readonly id: string;
  readonly type: NodeType;
  parentId: string | null;
  /** Child ids in paint order: later children are drawn on top. */
  children: string[];
}

export interface DesignDocument {
  id: string;
  name: string;
  rootId: string;
  nodes: Record<string, DesignNode>;
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
