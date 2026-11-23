import { expect, type Page } from '@playwright/test';

/**
 * Harbour Bakery's online ordering (role-played; the people and the bakery
 * are invented), with a design that answers its record (Workspace Phase 4,
 * decisions 9 to 11). The record has two confirmed findings, an assumption
 * and an open question, all entered by the consultant. The design "Order
 * page" has a frame with a heading, a date picker and a Pay button; the Pay
 * button is linked to "Customers pay online when they order", and the date
 * picker to "Orders need two days' notice". A second engagement, Wholesale, has a
 * finding of its own. The client's name is unique per call, so tests can run
 * side by side, unless `name` gives it (the demos, in their own data folder).
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
    /** Another engagement's: never in this one's record. */
    wholesale: { id: 'fd_wholesale', statement: 'Cafés order bread by six each morning.' },
  },
} as const;

export async function harbourBakery(
  page: Page,
  name = `Harbour Bakery ${Math.random().toString(36).slice(2, 8)}`,
): Promise<{ id: string; name: string }> {
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
    en_2: {
      id: 'en_2',
      companyId: id,
      name: 'Wholesale',
      goal: 'Supply bread to cafés.',
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
    [f.wholesale.id]: { ...finding(f.wholesale.id, 'constraint', f.wholesale.statement, 'confirmed', 5), engagementId: 'en_2' },
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

/**
 * A kick-off session in Online ordering, with consent in wording draft-1 (AI on this computer agreed, but the client
 * never told the AI may help sketch the screens), a note, and a confirmed finding resting on that note.
 */
export async function withUntoldSession(page: Page, id: string) {
  const opened = (await (await page.request.get(`/api/workspace/companies/${id}`, { headers: HEADERS })).json()) as {
    workspace: Record<string, Record<string, unknown>>;
    revision: string;
  };
  const ws = opened.workspace;
  const at = '2026-11-10T08:00:00.000Z';
  ws.sessions.se_1 = {
    id: 'se_1',
    engagementId: BAKERY.engagementId,
    title: 'Kick-off',
    startsAt: at,
    timeZone: 'Africa/Johannesburg',
    audioFileIds: [],
    deletedRecordings: [],
    aiStop: null,
    createdAt: at,
    updatedAt: at,
  };
  ws.participants.pa_nomsa = {
    id: 'pa_nomsa',
    sessionId: 'se_1',
    name: 'Nomsa Dube',
    role: 'Owner',
    organisation: 'Harbour Bakery',
    side: 'client',
    speakerLabels: [],
  };
  ws.consents.cr_1 = {
    id: 'cr_1',
    sessionId: 'se_1',
    askedParticipantIds: ['pa_nomsa'],
    askedBy: 'Sam Consultant',
    method: { kind: 'verbal-at-start' },
    wordingVersion: 'draft-1',
    told: {
      recorded: false,
      transcribed: false,
      aiExtraction: true,
      aiDesign: false,
      processingLocal: true,
      processingExternal: false,
      retention: false,
      canStopOrDelete: true,
      externalProvider: null,
    },
    given: { audioRecording: false, transcription: false, aiLocal: true, aiExternal: false, externalProvider: null },
    retention: { kind: 'until-engagement-ends' },
    outcome: { kind: 'given' },
    confirmed: { by: 'Sam Consultant', at },
    attachmentFileId: null,
    lockedAt: null,
    amendments: [],
    createdAt: at,
    updatedAt: at,
  };
  ws.notes.no_1 = {
    id: 'no_1',
    sessionId: 'se_1',
    text: 'Nomsa wants the cake photos big on the order page.',
    writtenAt: at,
    updatedAt: at,
  };
  const when = '2026-11-10T09:30:00.000Z';
  ws.findings.fd_photos = {
    id: 'fd_photos',
    engagementId: BAKERY.engagementId,
    kind: 'design-preference',
    statement: 'Cake photos are shown large.',
    status: 'confirmed',
    statusSet: { by: { kind: 'consultant', name: 'Sam Consultant' }, at: when },
    provenance: { kind: 'consultant' },
    evidence: [{ kind: 'note', noteId: 'no_1', quote: 'cake photos big' }],
    origin: { kind: 'consultant', by: 'Sam Consultant', at: when },
    history: [],
    createdAt: when,
    updatedAt: when,
  };
  const saved = await page.request.put(`/api/workspace/companies/${id}`, {
    headers: HEADERS,
    data: { workspace: ws, baseRevision: opened.revision },
  });
  expect(saved.status(), await saved.text()).toBe(200);
}
