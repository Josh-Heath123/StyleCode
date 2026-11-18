import { describe, expect, it } from 'vitest';
import { AI_PROPERTIES, responseSchema } from '../ai/schema';
import { reactAppFiles, staticSiteFiles } from '../codegen/exporters';
import { buildDoc, withBlock } from '../codegen/fixtures';
import {
  copyToClipboardData,
  layersLinkedTo,
  linkFindingOps,
  pasteOps,
  stripFindings,
  unlinkFindingOps,
  withoutFindings,
} from './commands';
import { applyOps } from './ops';
import { coerceProp } from './properties';
import { parseProject, SCHEMA_VERSION, toProjectFile } from './serialize';
import type { DesignDocument } from './types';

/**
 * Links from layers to the record's findings (Workspace Phase 4, decision 10):
 * a layer's `findings`, design file version 5.
 */

const design = (): DesignDocument =>
  buildDoc({
    type: 'frame',
    id: 'screen',
    props: { name: 'Checkout', layout: 'column', gap: 8, width: 400 },
    children: [
      { type: 'text', id: 'title', props: { name: 'Title', text: 'Pay' } },
      { type: 'rect', id: 'button', props: { name: 'Pay button', fill: '#2f7bff', width: 120, height: 40 } },
    ],
  });

const linked = (doc: DesignDocument): DesignDocument =>
  applyOps(doc, [
    ...linkFindingOps(doc, ['button', 'title'], 'fi_pay'),
    { type: 'update', id: 'button', props: { findings: ['fi_pay', 'fi_card'] } },
  ]).doc;

describe('the findings property', () => {
  it('holds distinct valid ids, and refuses anything else', () => {
    expect(coerceProp('findings', ['fi_a', 'fi_b'])).toEqual({ ok: true, value: ['fi_a', 'fi_b'] });
    expect(coerceProp('findings', [])).toEqual({ ok: true, value: [] });
    expect(coerceProp('findings', 'fi_a').ok).toBe(false);
    expect(coerceProp('findings', ['fi_a', 'fi_a']).ok).toBe(false);
    expect(coerceProp('findings', ['not an id']).ok).toBe(false);
    expect(coerceProp('findings', ['__proto__']).ok).toBe(false);
    expect(coerceProp('findings', [1]).ok).toBe(false);
  });

  it('is on shapes, frames, text and images, not on the page or notes', () => {
    const doc = design();
    expect(() => applyOps(doc, [{ type: 'update', id: doc.rootId, props: { findings: ['fi_a'] } }])).toThrow(/does not apply/);
    expect(linkFindingOps(doc, [doc.rootId], 'fi_a')).toEqual([]);
  });

  it('a link and an unlink are one undoable change each, and setting the same list again changes nothing', () => {
    const doc = design();
    const link = applyOps(doc, linkFindingOps(doc, ['button'], 'fi_pay'));
    expect(link.doc.nodes.button.findings).toEqual(['fi_pay']);
    expect(applyOps(link.doc, link.inverse).doc).toEqual(doc);
    // Linking again does nothing; the same list in a new array is no change either.
    expect(linkFindingOps(link.doc, ['button'], 'fi_pay')).toEqual([]);
    expect(applyOps(link.doc, [{ type: 'update', id: 'button', props: { findings: ['fi_pay'] } }]).inverse).toEqual([]);
    const unlink = applyOps(link.doc, unlinkFindingOps(link.doc, ['button'], 'fi_pay'));
    expect(unlink.doc.nodes.button.findings).toEqual([]);
    expect(applyOps(unlink.doc, unlink.inverse).doc).toEqual(link.doc);
  });

  it('links several layers at once, after their own links, and lists a finding’s layers in document order', () => {
    const doc = linked(design());
    expect(doc.nodes.button.findings).toEqual(['fi_pay', 'fi_card']);
    expect(doc.nodes.title.findings).toEqual(['fi_pay']);
    expect(layersLinkedTo(doc, 'fi_pay')).toEqual(['title', 'button']);
    expect(layersLinkedTo(doc, 'fi_card')).toEqual(['button']);
    expect(layersLinkedTo(doc, 'fi_none')).toEqual([]);
  });

  it('moves with its layer and goes when it is deleted', () => {
    let doc = linked(design());
    doc = applyOps(doc, [{ type: 'move', id: 'button', parentId: doc.rootId, index: 0 }]).doc;
    expect(doc.nodes.button.findings).toEqual(['fi_pay', 'fi_card']);
    doc = applyOps(doc, [{ type: 'delete', id: 'button' }]).doc;
    expect(layersLinkedTo(doc, 'fi_card')).toEqual([]);
  });
});

describe('the design file', () => {
  it('is version 5, and keeps links through a save and an open', () => {
    expect(SCHEMA_VERSION).toBe(5);
    const doc = linked(design());
    const file = JSON.parse(JSON.stringify(toProjectFile(doc)));
    expect(file.version).toBe(5);
    const opened = parseProject(file);
    expect(opened.ok && opened.doc).toEqual(doc);
    expect(opened.ok && opened.warnings).toEqual([]);
  });

  it('opens a version 4 file unchanged: every layer as it was, with no links and no warnings', () => {
    const doc = design();
    const file = JSON.parse(JSON.stringify(toProjectFile(doc)));
    file.version = 4;
    for (const node of Object.values(file.document.nodes) as Record<string, unknown>[]) delete node.findings;
    const opened = parseProject(file);
    if (!opened.ok) throw new Error(opened.error);
    expect(opened.warnings).toEqual([]);
    expect(opened.doc).toEqual(doc);
    for (const node of Object.values(opened.doc.nodes)) expect(node.findings).toEqual([]);
  });

  it('drops a damaged list of links rather than the layer, and says so', () => {
    const file = JSON.parse(JSON.stringify(toProjectFile(design())));
    file.document.nodes.button.findings = ['fi_ok', 'fi_ok'];
    const opened = parseProject(file);
    if (!opened.ok) throw new Error(opened.error);
    expect(opened.doc.nodes.button.findings).toEqual([]);
    expect(opened.warnings).toEqual([expect.stringContaining('findings')]);
  });
});

describe('copying layers and designs', () => {
  it('a paste into the same design keeps the links', () => {
    const doc = linked(design());
    const data = JSON.parse(JSON.stringify(copyToClipboardData(doc, ['button'])));
    const { ops, newIds } = pasteOps(doc, data, null);
    const pasted = applyOps(doc, ops).doc;
    expect(pasted.nodes[newIds[0]].findings).toEqual(['fi_pay', 'fi_card']);
  });

  it('a paste into any other design drops them, as does clipboard data that doesn’t say where it came from', () => {
    const from = linked(design());
    const other = { ...design(), id: 'doc_other' };
    const data = JSON.parse(JSON.stringify(copyToClipboardData(from, ['screen'])));
    const into = (d: typeof data) => {
      const { ops, newIds } = pasteOps(other, d, null);
      const pasted = applyOps(other, ops).doc;
      const added = Object.values(pasted.nodes).filter((n) => !other.nodes[n.id]);
      expect(added.length).toBe(3);
      expect(newIds).toHaveLength(1);
      return added.map((n) => n.findings);
    };
    expect(into(data)).toEqual([[], [], []]);
    expect(into({ ...data, sourceDocId: undefined })).toEqual([[], [], []]);
  });

  it('a whole design copied into an engagement has none, and the original keeps its own', () => {
    const doc = linked(design());
    const stripped = stripFindings(doc);
    expect(Object.values(stripped.nodes).every((n) => n.findings.length === 0)).toBe(true);
    expect(doc.nodes.button.findings).toEqual(['fi_pay', 'fi_card']);
    const plain = design();
    expect(stripFindings(plain)).toBe(plain);
    expect(withoutFindings([doc.nodes.button])[0].findings).toEqual([]);
  });
});

describe('what links never reach', () => {
  const images = new Map<string, { type: string; data: Uint8Array }>();
  const fonts = new Map<string, Uint8Array>();
  const text = (files: { path: string; content: string | Uint8Array }[]) =>
    files.map((f) => [f.path, typeof f.content === 'string' ? f.content : Buffer.from(f.content).toString('base64')]);

  it('code export is byte-for-byte the same with links', () => {
    const plain = withBlock(withBlock(design(), 'card', 'screen'), 'navigation', 'screen');
    let doc = plain;
    for (const id of Object.keys(doc.nodes)) doc = applyOps(doc, linkFindingOps(doc, [id], 'fi_pay')).doc;
    expect(Object.values(doc.nodes).filter((n) => n.findings.length).length).toBeGreaterThan(3);
    expect(text(staticSiteFiles({ doc, images, fonts }))).toEqual(text(staticSiteFiles({ doc: plain, images, fonts })));
    expect(text(reactAppFiles({ doc, images, fonts }))).toEqual(text(reactAppFiles({ doc: plain, images, fonts })));
  });

  it('the AI can’t set them: not in its properties or its reply schema', () => {
    expect(AI_PROPERTIES).not.toContain('findings');
    expect(JSON.stringify(responseSchema())).not.toContain('findings');
  });
});
