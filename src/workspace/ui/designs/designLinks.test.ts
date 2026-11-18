import { describe, expect, it } from 'vitest';
import { createNode } from '../../../model/defaults';
import { createDocument } from '../../../model/document';
import { applyOps, type Op } from '../../../model/ops';
import type { DesignDocument } from '../../../model/types';
import type { DesignLink } from '../../model/types';
import { layersByFinding } from './designLinks';

/** "In designs:" on the record page (Workspace Phase 4, decision 11). Harbour Bakery is role-played. */

function design(name: string, layers: { id: string; name: string; findings: string[] }[]): DesignDocument {
  const doc = createDocument(name);
  const ops: Op[] = [
    { type: 'create', parentId: doc.rootId, index: 0, nodes: [createNode('frame', { name: 'Screen' }, 'n_screen')] },
  ];
  layers.forEach((l, i) =>
    ops.push({
      type: 'create',
      parentId: 'n_screen',
      index: i,
      nodes: [createNode('rect', { name: l.name, findings: l.findings }, l.id)],
    }),
  );
  return applyOps(doc, ops).doc;
}

const link = (id: string, name: string): DesignLink => ({
  id,
  engagementId: 'en_1',
  name,
  documentId: `doc_${id}`,
  createdAt: '2026-11-10T09:00:00.000Z',
});

describe('the layers that answer each finding', () => {
  it('lists every linked layer under each of its findings, designs by name and layers in document order', () => {
    const checkout = design('Checkout', [
      { id: 'n_total', name: 'Total', findings: ['fd_pay'] },
      { id: 'n_pay', name: 'Pay button', findings: ['fd_pay', 'fd_notice'] },
      { id: 'n_logo', name: 'Logo', findings: [] },
    ]);
    const basket = design('Basket', [{ id: 'n_date', name: 'Collection date', findings: ['fd_notice'] }]);
    const links = layersByFinding('co_bakery', [
      { link: link('de_checkout', 'Checkout'), doc: checkout },
      { link: link('de_basket', 'Basket'), doc: basket },
    ]);
    expect(links.get('fd_pay')?.map((l) => l.label)).toEqual(['Checkout › Total', 'Checkout › Pay button']);
    expect(links.get('fd_notice')?.map((l) => l.label)).toEqual(['Basket › Collection date', 'Checkout › Pay button']);
    expect(links.get('fd_notice')?.[1]).toEqual({
      designId: 'de_checkout',
      layerId: 'n_pay',
      label: 'Checkout › Pay button',
      href: '#/c/co_bakery/e/en_1/d/de_checkout/l/n_pay',
    });
    expect(links.has('fd_other')).toBe(false);
  });

  it('is empty when no layer links to anything', () => {
    expect(
      layersByFinding('co_bakery', [{ link: link('de_a', 'A'), doc: design('A', [{ id: 'n_a', name: 'A', findings: [] }]) }])
        .size,
    ).toBe(0);
  });
});
