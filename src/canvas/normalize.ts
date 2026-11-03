import type { Normalizer } from '../editor/editor';
import { layoutOps, layoutRoots, minSizeOps, type TextMeasure } from '../model/layout';
import { applyOps } from '../model/ops';
import { measureText, textAutoSize } from './measure';

/** Text measurement for the layout engine: natural size, or height when wrapped at a given width. */
const measureForLayout: TextMeasure = (node, width) =>
  width === undefined ? measureText(node) : measureText({ ...node, textResize: 'auto-height', width });

/**
 * Runs after every change, inside the same transaction: fits auto-sizing text
 * to its content, keeps boxes at least as big as their border and padding,
 * then re-runs auto-layout for every frame the change could affect. Undo
 * therefore restores sizes and positions exactly.
 */
export const normalizeDocument: Normalizer = (doc, touched, base) => {
  const textOps = textAutoSize(doc, touched, base);
  const afterText = textOps.length ? applyOps(doc, textOps).doc : doc;
  const sizeOps = minSizeOps(afterText, touched);
  const afterSize = sizeOps.length ? applyOps(afterText, sizeOps).doc : afterText;
  const roots = layoutRoots(afterSize, touched, base);
  const ops = [...textOps, ...sizeOps];
  return roots.length ? [...ops, ...layoutOps(afterSize, roots, measureForLayout)] : ops;
};
