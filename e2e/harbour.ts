import { expect, type Page } from '@playwright/test';

/**
 * Harbour Bakery's online ordering (role-played; the people and the bakery
 * are invented), with a design that answers its record (Workspace Phase 4,
 * decisions 9 to 11). The record has two confirmed findings, an assumption
 * and an open question, all entered by the consultant. The design "Order
 * page" has a frame with a heading, a date picker and a Pay button; the Pay
 * button is linked to "Customers pay online when they order", and the date
 * picker to "Orders need two days' notice". The client's name is unique per
 * call, so tests can run side by side.
 */
const HEADERS = { 'x-stylecode-workspace': '1' };

export const BAKERY = {
  engagementId: 'en_1',
  designId: 'de_order',
  documentId: 'doc_orderpage',
  layers: { frame: 'n_frame', heading: 'n_heading', date: 'n_date', pay: 'n_pay' },
  findings: {
    pay: { id: 'fd_pay', statement: 'Customers pay online when they order.' },
    notice: { id: 'fd_notice', statement: 'Orders need two days’ notice.' },
    pickup: { id: 'fd_pickup', statement: 'Most customers collect from the Harbour Road shop.' },
    delivery: { id: 'fd_delivery', statement: 'Should the bakery deliver cakes?' },
  },
} as const;

export async function harbourBakery(page: Page): Promise<{ id: string; name: string }> {
  const name = `Harbour Bakery ${Math.random().toString(36).slice(2, 8)}`;
  const res = await page.request.post('/api/workspace/companies', { headers: HEADERS, data: { profile: { name } } });
  const opened = (await res.json()) as { workspace: Record<string, unknown> & { company: { id: string } }; revision: string };
  const ws = opened.workspace;
  const id = ws.company.id;
  const at = '2026-11-10T09:00:00.000Z';
  const finding = (fid: string, kind: string, statement: string, status: string, minutes: number) => {
    const when = new Date(Date.parse(at) + minutes * 60_000).toISOString();
    return {
      id: fid,
      engagementId: BAKERY.engagementId,
      kind,
      statement,
      status,
      statusSet: { by: { kind: 'consultant', name: 'Sam Consultant' }, at: when },
      provenance: { kind: 'consultant' },
      evidence: [],
      origin: { kind: 'consultant', by: 'Sam Consultant', at: when },
      history: [],
      createdAt: when,
      updatedAt: when,
    };
  };
  const f = BAKERY.findings;
  ws.engagements = {
    en_1: {
      id: 'en_1',
      companyId: id,
      name: 'Online ordering',
      goal: 'Take cake orders online.',
      status: { state: 'active' },
      createdAt: at,
      updatedAt: at,
    },
  };
  ws.findings = {
    [f.pay.id]: finding(f.pay.id, 'functional-requirement', f.pay.statement, 'confirmed', 1),
    [f.notice.id]: finding(f.notice.id, 'constraint', f.notice.statement, 'confirmed', 2),
    [f.pickup.id]: finding(f.pickup.id, 'expectation', f.pickup.statement, 'assumption', 3),
    [f.delivery.id]: finding(f.delivery.id, 'open-question', f.delivery.statement, 'unresolved', 4),
  };
  ws.designs = {
    [BAKERY.designId]: {
      id: BAKERY.designId,
      engagementId: BAKERY.engagementId,
      name: 'Order page',
      documentId: BAKERY.documentId,
      createdAt: at,
    },
  };
  const saved = await page.request.put(`/api/workspace/companies/${id}`, {
    headers: HEADERS,
    data: { workspace: ws, baseRevision: opened.revision },
  });
  expect(saved.status(), await saved.text()).toBe(200);

  const L = BAKERY.layers;
  const layer = (lid: string, type: string, props: Record<string, unknown>, children: string[] = []) => ({
    id: lid,
    type,
    parentId: null,
    children,
    ...props,
  });
  const file = {
    format: 'stylecode',
    version: 5,
    savedAt: at,
    document: {
      id: BAKERY.documentId,
      name: 'Order page',
      rootId: 'n_page',
      nodes: {
        n_page: layer('n_page', 'page', { name: 'Page', fill: '#0d1017' }, [L.frame]),
        [L.frame]: layer(L.frame, 'frame', { name: 'Checkout', fill: '#ffffff', width: 1440, height: 900 }, [
          L.heading,
          L.date,
          L.pay,
        ]),
        [L.heading]: layer(L.heading, 'text', {
          name: 'Heading',
          text: 'Order a cake',
          fill: '#11141a',
          fontSize: 40,
          x: 120,
          y: 100,
          width: 400,
          height: 52,
        }),
        [L.date]: layer(L.date, 'rect', {
          name: 'Collection date',
          fill: '#e4e7ec',
          x: 120,
          y: 200,
          width: 320,
          height: 48,
          findings: [f.notice.id],
        }),
        [L.pay]: layer(L.pay, 'rect', {
          name: 'Pay button',
          fill: '#2f7bff',
          x: 120,
          y: 280,
          width: 200,
          height: 48,
          findings: [f.pay.id],
        }),
      },
    },
  };
  const created = await page.request.post(`/api/workspace/companies/${id}/designs`, {
    headers: HEADERS,
    data: { documentId: BAKERY.documentId, file },
  });
  expect(created.status(), await created.text()).toBe(201);
  await page.request.put('/api/workspace/settings', { headers: HEADERS, data: { consultantName: 'Sam Consultant' } });
  return { id, name };
}

/** Opens the design in the editor, optionally at one layer. */
export async function openOrderPage(page: Page, companyId: string, layerId?: string): Promise<void> {
  await page.goto(`/#/c/${companyId}/e/${BAKERY.engagementId}/d/${BAKERY.designId}${layerId ? `/l/${layerId}` : ''}`);
  await page.waitForSelector('.canvas');
  await expect(page.getByLabel('Design name')).toHaveValue('Order page');
}
