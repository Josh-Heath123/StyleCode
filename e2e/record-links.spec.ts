import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { BAKERY, harbourBakery, openOrderPage } from './harbour';
import { openFreshProject, select, snapshot } from './helpers';
import { E2E_WORKSPACE } from './workspaceFolder';

/**
 * The record beside the canvas, and links from layers to findings (Workspace
 * Phase 4, Slice B; decisions 9 to 11). Harbour Bakery is role-played.
 */

const L = BAKERY.layers;
/** Text containing this, as a pattern for toHaveText. */
const has = (text: string) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const F = BAKERY.findings;
const recordPanel = (page: Page) => page.getByRole('complementary', { name: 'Record' });
const findingsSection = (page: Page) => page.getByRole('list', { name: 'Findings' });
const linksOnDisk = (companyId: string) => {
  const file = JSON.parse(
    readFileSync(join(E2E_WORKSPACE, 'companies', companyId, 'designs', `${BAKERY.documentId}.stylecode.json`), 'utf8'),
  ) as { version: number; document: { nodes: Record<string, { findings?: string[] }> } };
  return { version: file.version, findings: (id: string) => file.document.nodes[id]?.findings ?? [] };
};
const axe = async (page: Page) =>
  expect(
    (
      await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).exclude('.canvas-content').analyze()
    ).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
  ).toEqual([]);

test('the Record panel lists the engagement’s findings in their four groups, filters them, and is only read here', async ({
  page,
}) => {
  const { id } = await harbourBakery(page);
  await openOrderPage(page, id);
  const panel = recordPanel(page);
  await expect(panel.getByRole('heading', { level: 3 })).toHaveText(['Confirmed (2)', 'Assumptions (1)', 'Open (1)']);
  await expect(panel.getByRole('listitem')).toHaveCount(4);
  const pay = panel.getByRole('listitem').filter({ hasText: F.pay.statement });
  await expect(pay).toContainText('Functional requirement');
  await expect(pay).toContainText('Confirmed');
  await expect(pay).toContainText('1 layer linked');
  // Nothing is selected, so there is nothing to link to; findings aren't changed here.
  await expect(panel.getByRole('button', { name: /Link|Unlink|Change|Delete/ })).toHaveCount(0);
  await expect(panel.getByRole('link', { name: 'Open the record to change findings' })).toHaveAttribute(
    'href',
    `#/c/${id}/e/${BAKERY.engagementId}/record`,
  );

  const filter = panel.getByRole('searchbox', { name: 'Filter the record' });
  await filter.fill('cake');
  await expect(panel.getByRole('listitem')).toHaveText([has(F.delivery.statement)]);
  await expect(panel.getByRole('status')).toHaveText('1 of 4 findings');
  await filter.fill('constraint');
  await expect(panel.getByRole('listitem')).toHaveText([has(F.notice.statement)]);
  await filter.fill('nothing like this');
  await expect(panel).toContainText('No findings match the filter.');
  await filter.press('Escape');
  await expect(filter).toHaveValue('');
  await expect(panel.getByRole('listitem')).toHaveCount(4);
  await axe(page);
});

test('link a layer from the canvas, see it from both sides, follow it back to the layer, and undo it', async ({ page }) => {
  const { id } = await harbourBakery(page);
  await openOrderPage(page, id);
  await select(page, [L.heading]);
  const panel = recordPanel(page);
  await expect(findingsSection(page)).toHaveCount(0);
  await expect(page.getByText('Not linked to a finding.')).toBeVisible();

  await panel.getByRole('button', { name: `Link to the selected layer: “${F.pickup.statement}”` }).click();
  await expect(page.locator('.notice')).toHaveText(`Linked “Heading” to “${F.pickup.statement}”.`);
  await expect(findingsSection(page).getByRole('listitem')).toHaveText([has(F.pickup.statement)]);
  await expect(findingsSection(page)).toContainText('Expectation · Status: Assumption');
  // The editor with a live link: the panel's linked row and the layer's findings pass the accessibility check.
  await axe(page);
  await expect(panel.getByRole('button', { name: `Unlink from the selected layer: “${F.pickup.statement}”` })).toBeVisible();
  // Saved into the design, in the client's folder, as design file version 5.
  await expect.poll(() => linksOnDisk(id).findings(L.heading)).toEqual([F.pickup.id]);
  expect(linksOnDisk(id).version).toBe(5);

  // The record page shows the link, and follows it back to the layer.
  await findingsSection(page)
    .getByRole('link', { name: `Open in the record: “${F.pickup.statement}”` })
    .click();
  await expect(page).toHaveURL(new RegExp(`/record/f/${F.pickup.id}$`));
  const card = page.locator(`#finding-${F.pickup.id}`);
  await expect(card).toBeFocused();
  await expect(card.getByRole('list', { name: 'In designs:' }).getByRole('link')).toHaveText(['Order page › Heading']);
  const pay = page.locator(`#finding-${F.pay.id}`);
  await expect(pay.getByRole('list', { name: 'In designs:' }).getByRole('link')).toHaveText(['Order page › Pay button']);
  await expect(page.locator(`#finding-${F.delivery.id}`).getByText('In designs:')).toHaveCount(0);
  await axe(page);
  await card.getByRole('link', { name: 'Order page › Heading' }).click();
  await page.waitForSelector('.canvas');
  await expect.poll(async () => (await snapshot(page)).selection).toEqual([L.heading]);

  // Undo takes the link back, in the editor and on disk.
  await page.keyboard.press('Control+z');
  await expect(page.getByText('Not linked to a finding.')).toBeVisible();
  await expect.poll(() => linksOnDisk(id).findings(L.heading)).toEqual([]);
  await page.getByRole('link', { name: 'Back to the engagement' }).click();
  await page.goto(`/#/c/${id}/e/${BAKERY.engagementId}/record`);
  await expect(page.locator(`#finding-${F.pickup.id}`)).toBeVisible();
  await expect(page.locator(`#finding-${F.pickup.id}`).getByText('In designs:')).toHaveCount(0);
});

test('several selected layers are linked at once, and Unlink in a layer’s properties removes just that one', async ({ page }) => {
  const { id } = await harbourBakery(page);
  await openOrderPage(page, id);
  await select(page, [L.heading, L.date]);
  const panel = recordPanel(page);
  await panel.getByRole('button', { name: `Link to the selected layers: “${F.pay.statement}”` }).click();
  await expect(page.locator('.notice')).toHaveText(`Linked 2 layers to “${F.pay.statement}”.`);
  await expect(panel.getByRole('listitem').filter({ hasText: F.pay.statement })).toContainText('3 layers linked');
  await expect.poll(() => linksOnDisk(id).findings(L.date)).toEqual([F.notice.id, F.pay.id]);

  await select(page, [L.date]);
  await expect(findingsSection(page).getByRole('listitem')).toHaveText([has(F.notice.statement), has(F.pay.statement)]);
  await findingsSection(page)
    .getByRole('button', { name: `Unlink: “${F.notice.statement}”` })
    .click();
  await expect(page.locator('.notice')).toHaveText(`Unlinked “Collection date” from “${F.notice.statement}”.`);
  await expect(findingsSection(page).getByRole('listitem')).toHaveText([has(F.pay.statement)]);
  await expect.poll(() => linksOnDisk(id).findings(L.date)).toEqual([F.pay.id]);
  await page.keyboard.press('Control+z');
  await expect(findingsSection(page).getByRole('listitem')).toHaveCount(2);
});

test('a link to a finding deleted from the record says “No longer in the record”, with Remove link', async ({ page }) => {
  const { id } = await harbourBakery(page);
  await page.goto(`/#/c/${id}/e/${BAKERY.engagementId}/record`);
  await page
    .locator(`#finding-${F.pay.id}`)
    .getByRole('button', { name: `Delete “${F.pay.statement}”` })
    .click();
  await expect(page.locator(`#finding-${F.pay.id}`)).toHaveCount(0);

  await openOrderPage(page, id, L.pay);
  await expect.poll(async () => (await snapshot(page)).selection).toEqual([L.pay]);
  const gone = findingsSection(page).getByRole('listitem');
  await expect(gone).toHaveText([has('No longer in the record')]);
  await expect(recordPanel(page).getByRole('listitem')).toHaveCount(3);
  await axe(page);
  await gone.getByRole('button', { name: 'Remove link' }).click();
  await expect(page.locator('.notice')).toHaveText('Removed a link from “Pay button” to a finding no longer in the record.');
  await expect(page.getByText('Not linked to a finding.')).toBeVisible();
  await expect.poll(() => linksOnDisk(id).findings(L.pay)).toEqual([]);
});

test('from the keyboard: Alt+R hides and shows the record, focus goes into it, and a link is made and announced', async ({
  page,
}) => {
  const { id } = await harbourBakery(page);
  await openOrderPage(page, id, L.heading);
  await expect.poll(async () => (await snapshot(page)).selection).toEqual([L.heading]);
  // Hidden while focus is elsewhere, focus stays where it was.
  await page.locator('.canvas').focus();
  await page.keyboard.press('Alt+r');
  await expect(recordPanel(page)).toHaveCount(0);
  await expect(page.locator('.canvas')).toBeFocused();
  await page.keyboard.press('Alt+r');
  const filter = recordPanel(page).getByRole('searchbox', { name: 'Filter the record' });
  await expect(filter).toBeFocused();
  // Hidden from inside it, focus goes to the layers beside it; with the Insert tab showing, to the canvas.
  await page.keyboard.press('Alt+r');
  await expect(page.getByRole('tree', { name: 'Layers' })).toBeFocused();
  await page.getByRole('tab', { name: 'Insert' }).click();
  await page.keyboard.press('Alt+r');
  await expect(filter).toBeFocused();
  await page.keyboard.press('Alt+r');
  await expect(page.locator('.canvas')).toBeFocused();
  await page.getByRole('tab', { name: 'Layers' }).click();
  await page.keyboard.press('Alt+r');
  await expect(filter).toBeFocused();
  // Tab from the filter reaches the first finding's Link button.
  const link = recordPanel(page).getByRole('button', { name: `Link to the selected layer: “${F.pay.statement}”` });
  for (let i = 0; i < 6 && !(await link.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
  await expect(link).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.app [role="status"][aria-live="polite"]').first()).toHaveText(
    `Linked “Heading” to “${F.pay.statement}”.`,
  );
  await expect.poll(() => linksOnDisk(id).findings(L.heading)).toEqual([F.pay.id]);
  // The Design menu says how to show or hide it too.
  await page.getByRole('button', { name: 'Design', exact: true }).click();
  await expect(page.getByRole('menuitem')).toHaveText(['Back to the engagement', /^Hide the record/, 'Download as file…']);
  await page.getByRole('menuitem', { name: /^Hide the record/ }).click();
  await expect(recordPanel(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Design', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Show the record/ }).click();
  await expect(recordPanel(page)).toBeVisible();
  await recordPanel(page).getByRole('button', { name: 'Hide the record' }).click();
  await expect(recordPanel(page)).toHaveCount(0);
});

test('the standalone editor has no record and no findings, and a layer pasted from a client’s design loses its links', async ({
  page,
}) => {
  const { id } = await harbourBakery(page);
  await openOrderPage(page, id, L.pay);
  await expect.poll(async () => (await snapshot(page)).selection).toEqual([L.pay]);
  await page.locator('.canvas').focus();
  await page.keyboard.press('Control+c');
  await openFreshProject(page);
  await expect(recordPanel(page)).toHaveCount(0);
  await page.keyboard.press('Alt+r');
  await expect(recordPanel(page)).toHaveCount(0);
  await page.locator('.canvas').click({ position: { x: 600, y: 400 } });
  await page.keyboard.press('Control+v');
  await expect.poll(async () => (await snapshot(page)).selection.length).toBe(1);
  const s = await snapshot(page);
  expect(s.doc.nodes[s.selection[0]].name).toBe('Pay button');
  expect(s.doc.nodes[s.selection[0]].findings).toEqual([]);
  await expect(page.getByText('Not linked to a finding.')).toHaveCount(0);
  await expect(page.locator('#layer-findings-title')).toHaveCount(0);
});

test('a design’s route opened directly shows the design in view, and its layer route shows that layer (Slice A’s camera)', async ({
  page,
}) => {
  const { id } = await harbourBakery(page);
  const inCanvas = async (layerId: string, minWidth: number) => {
    const canvas = (await page.locator('.canvas').boundingBox())!;
    const box = (await page.locator(`[data-node-id="${layerId}"]`).boundingBox())!;
    expect(box.width).toBeGreaterThan(minWidth);
    expect(box.x).toBeGreaterThanOrEqual(canvas.x);
    expect(box.x + box.width).toBeLessThanOrEqual(canvas.x + canvas.width);
  };
  await openOrderPage(page, id);
  // The whole frame fits the canvas beside the Record panel, at a readable size, not the smallest zoom.
  await expect.poll(async () => (await snapshot(page)).camera.zoom).toBeGreaterThan(0.2);
  await inCanvas(L.frame, 300);
  await page.goto('about:blank');
  await openOrderPage(page, id, L.pay);
  await expect.poll(async () => (await snapshot(page)).selection).toEqual([L.pay]);
  await expect.poll(async () => (await snapshot(page)).camera.zoom).toBeGreaterThan(0.5);
  await inCanvas(L.pay, 100);
});

test('only this engagement’s findings appear: another engagement’s is neither listed nor shown on a layer', async ({ page }) => {
  const { id } = await harbourBakery(page);
  await openOrderPage(page, id, L.heading);
  await expect.poll(async () => (await snapshot(page)).selection).toEqual([L.heading]);
  await expect(recordPanel(page).getByRole('listitem')).toHaveCount(4);
  await expect(recordPanel(page)).not.toContainText(F.wholesale.statement);
  // A link to the Wholesale engagement's finding (as a hand-edited file could carry) isn't shown as that finding.
  await page.evaluate(
    ([layer, finding]) =>
      (
        window as unknown as { stylecode: { editor: { apply(ops: unknown[], o: { label: string }): unknown } } }
      ).stylecode.editor.apply([{ type: 'update', id: layer, props: { findings: [finding] } }], { label: 'Link' }),
    [L.heading, F.wholesale.id],
  );
  await expect(findingsSection(page).getByRole('listitem')).toHaveText([has('No longer in the record')]);
  await expect(page.getByText(F.wholesale.statement)).toHaveCount(0);
});

test('the view stays where it is when the client’s workspace changes beside the design, after a layer’s route', async ({
  page,
}) => {
  const { id } = await harbourBakery(page);
  // Open once, then come back by a layer's route while the design is still loaded, as "In designs:" does.
  await openOrderPage(page, id);
  await page.getByRole('link', { name: 'Back to the engagement' }).click();
  await openOrderPage(page, id, L.pay);
  await expect.poll(async () => (await snapshot(page)).selection).toEqual([L.pay]);
  await expect.poll(async () => (await snapshot(page)).camera.zoom).toBeGreaterThan(0.5);
  // Pan away, then rename the design: a change to the client's workspace.
  const before = (await snapshot(page)).camera;
  await page.locator('.canvas').hover({ position: { x: 300, y: 300 } });
  await page.mouse.wheel(0, 400);
  await expect.poll(async () => (await snapshot(page)).camera.y).not.toBe(before.y);
  const panned = (await snapshot(page)).camera;
  const name = page.getByLabel('Design name');
  await name.fill('Order page, renamed');
  await name.press('Enter');
  // The rename reaches the client's saved workspace (the design link's name), which re-renders the design's host.
  await expect
    .poll(async () => {
      const res = await page.request.get(`/api/workspace/companies/${id}`, { headers: { 'x-stylecode-workspace': '1' } });
      const ws = (await res.json()) as { workspace: { designs: Record<string, { name: string }> } };
      return ws.workspace.designs[BAKERY.designId].name;
    })
    .toBe('Order page, renamed');
  await expect(page.locator('.save-status')).toHaveText('Saved in the client’s folder');
  expect((await snapshot(page)).camera).toEqual(panned);
});
