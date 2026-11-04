import type { DesignNode, NodeProps, SizingMode } from './types';

/**
 * How sizing choices from the editor (fixed, hug, fill) become properties.
 * Text expresses hugging and fixed sizes through how it resizes.
 */

type Axis = 'width' | 'height';

/** The properties that give a layer a sizing mode. Text expresses hug and fixed through its resizing. */
export function sizingProps(node: DesignNode, axis: Axis, mode: SizingMode): Partial<NodeProps> {
  const modeKey = axis === 'width' ? 'widthMode' : 'heightMode';
  if (node.type !== 'text') return { [modeKey]: mode };
  if (axis === 'width') {
    if (mode === 'hug') return { widthMode: 'fixed', textResize: 'auto-width' };
    return { widthMode: mode, textResize: node.textResize === 'auto-width' ? 'auto-height' : node.textResize };
  }
  if (mode === 'fixed') return { heightMode: 'fixed', textResize: 'fixed' };
  // Text that hugs its width keeps doing so; the parent decides its height.
  if (mode === 'fill') return { heightMode: 'fill', textResize: node.textResize === 'auto-width' ? 'auto-width' : 'fixed' };
  return { heightMode: 'fixed', textResize: node.textResize === 'fixed' ? 'auto-height' : node.textResize };
}

/**
 * Typing a width or height gives the layer that size, so that axis stops
 * hugging or filling (as resizing with the handles does). Text that hugged its
 * width wraps at the new width instead.
 */
export function fixedWidth(node: DesignNode): Partial<NodeProps> {
  const props: Partial<NodeProps> = {};
  if (node.widthMode !== 'fixed') props.widthMode = 'fixed';
  if (node.type === 'text' && node.textResize === 'auto-width') props.textResize = 'auto-height';
  return props;
}

export function fixedHeight(node: DesignNode): Partial<NodeProps> {
  const props: Partial<NodeProps> = {};
  if (node.heightMode !== 'fixed') props.heightMode = 'fixed';
  if (node.type === 'text' && node.textResize !== 'fixed') props.textResize = 'fixed';
  return props;
}
