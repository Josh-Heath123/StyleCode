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

export type NodeType = 'page' | 'frame' | 'rect' | 'ellipse' | 'text';

/** Node types that can contain children. */
export const CONTAINER_TYPES: ReadonlySet<NodeType> = new Set<NodeType>(['page', 'frame']);

/** Node types a user (or the AI) may create. The page is created with the document. */
export const CREATABLE_TYPES: readonly NodeType[] = ['frame', 'rect', 'ellipse', 'text'];

export type TextAlign = 'left' | 'center' | 'right';

/**
 * How a text node sizes itself.
 * - auto-width: the box grows to fit the text on one line per paragraph
 * - auto-height: width is fixed, text wraps and the height grows to fit
 * - fixed: both dimensions are fixed; overflowing text is visible
 */
export type TextResize = 'auto-width' | 'auto-height' | 'fixed';

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
