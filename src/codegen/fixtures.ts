import { BLOCKS } from '../app/blocks';
import { createNode } from '../model/defaults';
import { createDocument } from '../model/document';
import { layoutOps, layoutRoots, type TextMeasure } from '../model/layout';
import { applyOps, type Op } from '../model/ops';
import type { DesignDocument, DesignNode, NodeProps } from '../model/types';

/**
 * Documents for code generation tests, laid out with a deterministic text
 * measure (8px per character, line height × font size per line).
 */
export const fakeMeasure: TextMeasure = (node, width) => {
  const lines = node.text.split('\n');
  const charWidth = node.fontSize * 0.5;
  const natural = Math.max(...lines.map((l) => l.length)) * charWidth;
  const lineHeight = Math.ceil(node.fontSize * node.lineHeight);
  if (width === undefined) return { width: Math.ceil(natural), height: lines.length * lineHeight };
  const rows = lines.reduce((sum, l) => sum + Math.max(1, Math.ceil((l.length * charWidth) / Math.max(1, width))), 0);
  return { width, height: rows * lineHeight };
};

export function settle(doc: DesignDocument): DesignDocument {
  return applyOps(doc, layoutOps(doc, layoutRoots(doc, Object.keys(doc.nodes)), fakeMeasure)).doc;
}

type Spec = { type: DesignNode['type']; id: string; props?: Partial<NodeProps>; children?: Spec[] };

/** Builds a document from a nested spec; the first spec is a top-level frame. */
export function buildDoc(...specs: Spec[]): DesignDocument {
  const base = createDocument('Test');
  const ops: Op[] = [];
  const add = (spec: Spec, parentId: string, index: number) => {
    ops.push({ type: 'create', parentId, index, nodes: [createNode(spec.type, spec.props ?? {}, spec.id)] });
    (spec.children ?? []).forEach((c, i) => add(c, spec.id, i));
  };
  specs.forEach((s, i) => add(s, base.rootId, i));
  return settle(applyOps(base, ops).doc);
}

/** Adds a block (as built by the Insert panel) inside a frame. */
export function withBlock(
  doc: DesignDocument,
  blockId: string,
  parentId: string,
  theme: 'light' | 'dark' = 'light',
): DesignDocument {
  const block = BLOCKS.find((b) => b.id === blockId)!;
  const nodes = block.build(theme);
  const index = doc.nodes[parentId].children.length;
  return settle(applyOps(doc, [{ type: 'create', parentId, index, nodes }]).doc);
}
