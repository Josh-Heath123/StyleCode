import { sortByDocumentOrder } from '../../../model/document';
import { propAppliesTo } from '../../../model/properties';
import type { DesignDocument } from '../../../model/types';
import { displayName } from '../../../panels/LayersPanel';
import type { DesignLink } from '../../model/types';
import { routeHref } from '../../routes';

/** A layer that answers a finding, as the record page lists it under "In designs:" (decision 11). */
export interface LayerLink {
  designId: string;
  layerId: string;
  /** "Checkout › Pay button": the design, then the layer. */
  label: string;
  href: string;
}

/**
 * Which layers of an engagement's designs link to each finding, from the
 * designs as read: designs in name order, layers in document order.
 */
export function layersByFinding(
  companyId: string,
  designs: readonly { link: DesignLink; doc: DesignDocument }[],
): Map<string, LayerLink[]> {
  const byFinding = new Map<string, LayerLink[]>();
  const sorted = [...designs].sort((a, b) => a.link.name.localeCompare(b.link.name) || a.link.id.localeCompare(b.link.id));
  for (const { link, doc } of sorted) {
    const linked = Object.values(doc.nodes).filter((n) => n.findings.length > 0 && propAppliesTo('findings', n.type));
    for (const layerId of sortByDocumentOrder(
      doc,
      linked.map((n) => n.id),
    )) {
      const layer = doc.nodes[layerId];
      for (const findingId of layer.findings) {
        const list = byFinding.get(findingId) ?? [];
        list.push({
          designId: link.id,
          layerId,
          label: `${link.name} › ${displayName(layer)}`,
          href: routeHref({ page: 'design', companyId, engagementId: link.engagementId, designId: link.id, layerId }),
        });
        byFinding.set(findingId, list);
      }
    }
  }
  return byFinding;
}
