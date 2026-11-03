import { createId } from './ids';
import type { DesignNode, NodeProps, NodeType } from './types';

export const DEFAULT_FONT_FAMILY = 'Inter';

const BASE_PROPS: NodeProps = {
  name: '',
  visible: true,
  locked: false,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  rotation: 0,
  opacity: 1,
  fill: null,
  stroke: null,
  strokeWidth: 1,
  radius: 0,
  clip: false,
  text: '',
  fontFamily: DEFAULT_FONT_FAMILY,
  fontSize: 16,
  fontWeight: 400,
  lineHeight: 1.4,
  letterSpacing: 0,
  textAlign: 'left',
  textResize: 'auto-width',
  layout: 'none',
  gap: 0,
  paddingTop: 0,
  paddingRight: 0,
  paddingBottom: 0,
  paddingLeft: 0,
  justify: 'start',
  align: 'start',
  wrap: false,
  widthMode: 'fixed',
  heightMode: 'fixed',
  positioning: 'auto',
  role: 'auto',
  shadowColor: null,
  shadowX: 0,
  shadowY: 8,
  shadowBlur: 24,
  shadowSpread: 0,
  backdropBlur: 0,
  gradientTo: null,
  gradientAngle: 180,
  src: '',
  fit: 'cover',
};

const TYPE_DEFAULTS: Record<NodeType, Partial<NodeProps>> = {
  page: { name: 'Page', fill: '#0d1017' },
  frame: { name: 'Frame', fill: '#ffffff', clip: true, width: 400, height: 300 },
  rect: { name: 'Rectangle', fill: '#d9dde4' },
  ellipse: { name: 'Ellipse', fill: '#d9dde4' },
  text: { name: 'Text', fill: '#11141a', text: 'Text', width: 40, height: 22 },
  image: { name: 'Image', fill: '#e4e7ec', width: 240, height: 160 },
};

export function defaultProps(type: NodeType): NodeProps {
  return { ...BASE_PROPS, ...TYPE_DEFAULTS[type] };
}

/** Creates a detached node. The caller decides where it goes via a `create` operation. */
export function createNode(type: NodeType, props: Partial<NodeProps> = {}, id = createId()): DesignNode {
  return {
    ...defaultProps(type),
    ...props,
    id,
    type,
    parentId: null,
    children: [],
  };
}

export const FRAME_PRESETS = [
  { label: 'Desktop', width: 1440, height: 900 },
  { label: 'Laptop', width: 1280, height: 800 },
  { label: 'Tablet', width: 834, height: 1194 },
  { label: 'Mobile', width: 390, height: 844 },
] as const;
