/**
 * Reads the catalogue's files from `catalogue/` (Workspace Phase 5, WP2) for `npm run check:catalogue` and the unit
 * tests. A file that isn't valid JSON is reported by name. The app reads the same files at build time instead.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CatalogueFiles } from '../src/catalogue/validate.ts';

export function readCatalogueFiles(root: string): { files: CatalogueFiles; problems: string[] } {
  const problems: string[] = [];
  const read = (name: string): unknown => {
    const path = join(root, name);
    if (!existsSync(path)) return (problems.push(`${name}: missing.`), undefined);
    try {
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      return (problems.push(`${name}: not valid JSON (${(error as Error).message}).`), undefined);
    }
  };
  const folder = (name: string): Record<string, unknown> => {
    const dir = join(root, name);
    const out: Record<string, unknown> = {};
    if (!existsSync(dir)) return out;
    for (const file of readdirSync(dir).sort()) {
      if (!file.endsWith('.json')) {
        problems.push(`${name}/${file}: only .json files belong here.`);
        continue;
      }
      out[file] = read(`${name}/${file}`);
    }
    return out;
  };
  return {
    files: {
      manifest: read('CATALOGUE.json'),
      countries: read('countries.json'),
      technologies: folder('technologies'),
      groups: folder('groups'),
    },
    problems,
  };
}
