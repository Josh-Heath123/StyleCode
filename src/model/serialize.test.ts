import { describe, expect, it } from 'vitest';
import { createNode } from './defaults';
import { checkIntegrity, createDocument } from './document';
import { applyOps } from './ops';
import { parseProject, toProjectFile } from './serialize';

describe('project files', () => {
  it('round-trips through JSON', () => {
    const base = createDocument('Round trip');
    const doc = applyOps(base, [
      { type: 'create', parentId: base.rootId, index: 0, nodes: [createNode('frame', {}, 'f')] },
      { type: 'create', parentId: 'f', index: 0, nodes: [createNode('text', { text: 'Hello' }, 't')] },
    ]).doc;
    const parsed = parseProject(JSON.parse(JSON.stringify(toProjectFile(doc))));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.doc).toEqual(doc);
      expect(parsed.warnings).toEqual([]);
    }
  });

  it('rejects files that are not projects or are from a newer version', () => {
    expect(parseProject({ hello: 'world' }).ok).toBe(false);
    expect(parseProject({ format: 'stylecode', version: 99, document: {} }).ok).toBe(false);
  });

  it('skips layers whose ids are unsafe map keys', () => {
    const base = createDocument();
    const file = JSON.parse(JSON.stringify(toProjectFile(base)));
    // JSON.parse creates "__proto__" as an own key, exactly as a malicious file would.
    const raw = JSON.parse(
      JSON.stringify(file).replace(
        '"nodes":{',
        '"nodes":{"__proto__":{"type":"rect","children":[]},"constructor":{"type":"rect","children":[]},',
      ),
    );
    raw.document.nodes[base.rootId].children.push('constructor');
    const parsed = parseProject(raw);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(Object.keys(parsed.doc.nodes)).toEqual([base.rootId]);
      expect(Object.getPrototypeOf(parsed.doc.nodes)).toBe(Object.prototype);
      expect(checkIntegrity(parsed.doc)).toEqual([]);
    }
  });

  it('repairs bad values and broken references instead of failing', () => {
    const base = createDocument();
    const doc = applyOps(base, [{ type: 'create', parentId: base.rootId, index: 0, nodes: [createNode('rect', {}, 'r')] }]).doc;
    const file = JSON.parse(JSON.stringify(toProjectFile(doc)));
    file.document.nodes.r.fill = 'not-a-colour';
    file.document.nodes[base.rootId].children.push('ghost');
    file.document.nodes.orphan = { ...file.document.nodes.r, id: 'orphan' };
    const parsed = parseProject(file);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.doc.nodes.r.fill).toBe('#d9dde4');
      expect(parsed.doc.nodes.orphan).toBeUndefined();
      expect(checkIntegrity(parsed.doc)).toEqual([]);
      expect(parsed.warnings.length).toBeGreaterThan(0);
    }
  });
});
