import { defaultProps } from './defaults';
import { isValidId } from './ids';
import { coerceProp, PROP_KEYS } from './properties';
import { CONTAINER_TYPES, type DesignDocument, type DesignNode, type NodeType } from './types';

/**
 * The on-disk project format. Files carry a format tag and a schema version
 * so future versions can migrate old projects instead of rejecting them.
 */
export const FILE_FORMAT = 'stylecode';
/** 2: auto-layout, sizing, roles, effects and image layers (version 1 files load unchanged). */
export const SCHEMA_VERSION = 2;
export const FILE_EXTENSION = '.stylecode.json';

export interface ProjectFile {
  format: typeof FILE_FORMAT;
  version: number;
  savedAt: string;
  document: DesignDocument;
  /** Images used by the document, base64-encoded, so a saved file is self-contained. */
  assets?: Record<string, { type: string; data: string }>;
}

export function toProjectFile(doc: DesignDocument, assets?: ProjectFile['assets']): ProjectFile {
  const file: ProjectFile = { format: FILE_FORMAT, version: SCHEMA_VERSION, savedAt: new Date().toISOString(), document: doc };
  if (assets && Object.keys(assets).length) file.assets = assets;
  return file;
}

/** Asset ids referenced by image layers. */
export function referencedAssets(doc: DesignDocument): string[] {
  return [
    ...new Set(
      Object.values(doc.nodes)
        .filter((n) => n.type === 'image' && n.src)
        .map((n) => n.src),
    ),
  ];
}

export type ParseResult = { ok: true; doc: DesignDocument; warnings: string[] } | { ok: false; error: string };

const has = (map: object, key: string) => Object.prototype.hasOwnProperty.call(map, key);

const KNOWN_TYPES = new Set<NodeType>(['page', 'frame', 'rect', 'ellipse', 'text', 'image']);

/**
 * Validates untrusted project data (a file, or something from storage) and
 * repairs what it safely can: invalid property values fall back to defaults
 * and dangling references are dropped. Anything it cannot make sense of is
 * rejected with a clear error instead of crashing the editor later.
 */
export function parseProject(input: unknown): ParseResult {
  if (!input || typeof input !== 'object') return { ok: false, error: 'The file is not a StyleCode project.' };
  const file = input as Partial<ProjectFile>;
  if (file.format !== FILE_FORMAT) return { ok: false, error: 'The file is not a StyleCode project.' };
  if (typeof file.version !== 'number') return { ok: false, error: 'The project has no schema version.' };
  if (file.version > SCHEMA_VERSION) {
    return {
      ok: false,
      error: `This project was saved by a newer version of StyleCode (schema ${file.version}). Update StyleCode to open it.`,
    };
  }
  return parseDocument(file.document);
}

export function parseDocument(input: unknown): ParseResult {
  const warnings: string[] = [];
  const raw = input as Partial<DesignDocument> | undefined;
  if (!raw || typeof raw !== 'object' || !raw.nodes || typeof raw.nodes !== 'object') {
    return { ok: false, error: 'The project has no layers.' };
  }
  if (!isValidId(raw.rootId) || !Object.prototype.hasOwnProperty.call(raw.nodes, raw.rootId)) {
    return { ok: false, error: 'The project has no page.' };
  }

  // 1. Sanitise each node individually.
  const clean: Record<string, DesignNode> = {};
  for (const [key, value] of Object.entries(raw.nodes as Record<string, unknown>)) {
    if (!isValidId(key)) {
      warnings.push(`Skipped a layer with an invalid id.`);
      continue;
    }
    const n = value as Partial<DesignNode> | null;
    if (!n || typeof n !== 'object' || typeof n.type !== 'string' || !KNOWN_TYPES.has(n.type as NodeType)) {
      warnings.push(`Skipped layer ${key}: unknown type.`);
      continue;
    }
    const type = n.type as NodeType;
    const defaults = defaultProps(type);
    const node = { id: key, type, parentId: null, children: [] as string[] } as unknown as DesignNode;
    for (const prop of PROP_KEYS) {
      const value = (n as Record<string, unknown>)[prop];
      const result = value === undefined ? null : coerceProp(prop, value);
      if (result && result.ok) {
        (node as unknown as Record<string, unknown>)[prop] = result.value;
      } else {
        if (result && !result.ok) warnings.push(`Layer ${key}: ${result.error}; reset to default.`);
        (node as unknown as Record<string, unknown>)[prop] = defaults[prop];
      }
    }
    node.children = Array.isArray(n.children) ? n.children.filter((c): c is string => typeof c === 'string') : [];
    clean[key] = node;
  }

  const root = clean[raw.rootId];
  if (!root || root.type !== 'page') return { ok: false, error: 'The project page is invalid.' };

  // 2. Rebuild the tree from the root so parent/child links are consistent.
  const nodes: Record<string, DesignNode> = {};
  const visit = (id: string, parentId: string | null) => {
    const node = clean[id];
    node.parentId = parentId;
    nodes[id] = node;
    const children: string[] = [];
    if (CONTAINER_TYPES.has(node.type)) {
      for (const childId of node.children) {
        if (!has(clean, childId) || has(nodes, childId) || childId === raw.rootId || clean[childId].type === 'page') {
          warnings.push(`Dropped a broken reference from ${id} to ${childId}.`);
          continue;
        }
        children.push(childId);
        visit(childId, id);
      }
    } else if (node.children.length) {
      warnings.push(`Removed children from ${id}, which cannot contain layers.`);
    }
    node.children = children;
  };
  visit(raw.rootId, null);

  const orphans = Object.keys(clean).filter((id) => !has(nodes, id));
  if (orphans.length) warnings.push(`Removed ${orphans.length} layer(s) that were not attached to the page.`);

  return {
    ok: true,
    doc: {
      id: typeof raw.id === 'string' && raw.id ? raw.id : `doc_${Date.now().toString(36)}`,
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.slice(0, 200) : 'Untitled',
      rootId: raw.rootId,
      nodes,
    },
    warnings,
  };
}
