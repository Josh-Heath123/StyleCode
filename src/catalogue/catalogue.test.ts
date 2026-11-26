import { describe, expect, it } from 'vitest';
import { readCatalogueFiles } from '../../scripts/catalogue-files.ts';
import { latestToday, validateCatalogue } from './validate.ts';

/** The catalogue in the repository (Workspace Phase 5, WP3) passes its own check, as CI's Quick checks run it. */
describe('the shipped catalogue', () => {
  it('passes the catalogue check', () => {
    const { files, problems } = readCatalogueFiles('catalogue');
    const result = validateCatalogue(files, latestToday());
    expect([...problems, ...(result.ok ? [] : result.problems)]).toEqual([]);
  });

  it('holds no client data: no file names a client, an engagement or a finding', () => {
    const { files } = readCatalogueFiles('catalogue');
    const text = JSON.stringify(files);
    for (const id of ['"co_', '"en_', '"fd_', '"se_']) expect(text).not.toContain(id);
  });
});
