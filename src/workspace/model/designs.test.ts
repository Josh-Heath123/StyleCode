import { describe, expect, it } from 'vitest';
import { attachDesign, designOfDocument, designsOf, removeDesign, renameDesign } from './designs.ts';
import { removeEngagement } from './findings.ts';
import { sampleWorkspace, T3 } from './fixtures.ts';
import { validateWorkspace } from './validate.ts';

/** Workspace Phase 4, WP2: an engagement's designs (decisions 1, 3, 5 and 6). Role-played data. */

const T5 = '2026-11-05T09:00:00.000Z';

function value<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe('attaching a design', () => {
  it('attaches a new design, or a copy, under a document id of its own, and stays valid', () => {
    const ws = value(
      attachDesign(sampleWorkspace(), { id: 'de_2', engagementId: 'en_1', name: ' Checkout ', documentId: 'doc_new1' }, T5),
    );
    expect(ws.designs.de_2).toEqual({
      id: 'de_2',
      engagementId: 'en_1',
      name: 'Checkout',
      documentId: 'doc_new1',
      createdAt: T5,
    });
    expect(validateWorkspace(ws)).toEqual([]);
    expect(designsOf(ws, 'en_1').map((d) => d.id)).toEqual(['de_1', 'de_2']);
    expect(designOfDocument(ws, 'doc_new1')?.id).toBe('de_2');
  });

  it('refuses a document linked already, an engagement that isn’t there, no name, a bad id, and an id in use', () => {
    const ws = sampleWorkspace();
    const design = { id: 'de_2', engagementId: 'en_1', name: 'Checkout', documentId: 'doc_new1' };
    expect(attachDesign(ws, { ...design, documentId: 'doc_abc123' }, T5)).toMatchObject({ ok: false, error: /attached already/ });
    expect(attachDesign(ws, { ...design, engagementId: 'en_x' }, T5)).toMatchObject({ ok: false, error: /engagement/ });
    expect(attachDesign(ws, { ...design, name: '  ' }, T5)).toMatchObject({ ok: false, error: /name/ });
    expect(attachDesign(ws, { ...design, documentId: '../x' }, T5)).toMatchObject({ ok: false, error: /document id/ });
    expect(attachDesign(ws, { ...design, id: 'de_1' }, T5)).toMatchObject({ ok: false, error: /exists/ });
  });

  it('reports two links to one document as a problem', () => {
    const ws = sampleWorkspace();
    ws.designs.de_2 = { ...ws.designs.de_1, id: 'de_2' };
    expect(validateWorkspace(ws).map((p) => p.code)).toContain('design.document');
  });
});

describe('renaming and removing a design', () => {
  it('renames, trimmed, and refuses an empty name or no change', () => {
    const ws = value(renameDesign(sampleWorkspace(), 'de_1', ' Order page, mobile '));
    expect(ws.designs.de_1.name).toBe('Order page, mobile');
    expect(renameDesign(ws, 'de_1', '')).toMatchObject({ ok: false });
    expect(renameDesign(ws, 'de_1', 'Order page, mobile')).toMatchObject({ ok: false, error: /Nothing/ });
    expect(renameDesign(ws, 'de_x', 'A')).toMatchObject({ ok: false });
  });

  it('removes one, and the engagement’s deletion removes its designs', () => {
    expect(value(removeDesign(sampleWorkspace(), 'de_1')).designs).toEqual({});
    expect(removeDesign(sampleWorkspace(), 'de_x')).toMatchObject({ ok: false });
    expect(value(removeEngagement(sampleWorkspace(), 'en_1', T3)).workspace.designs).toEqual({});
  });
});
