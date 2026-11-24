import { describe, expect, it } from 'vitest';
import { isRealDate, latestToday, validateCatalogue, type CatalogueFiles } from './validate.ts';

/** The catalogue's check (Workspace Phase 5, WP2): a small valid catalogue, then one broken thing at a time. */

const TODAY = '2026-11-24';
const SOURCE = { title: 'Docs', publisher: 'The project', url: 'https://example.org/docs' };

function valid(): CatalogueFiles & { technologies: Record<string, Record<string, unknown>> } {
  return {
    manifest: { version: 1, date: TODAY, order: ['postgresql', 'cloud'] },
    countries: { codes: ['DE', 'NL', 'ZA'], source: SOURCE, checkedOn: TODAY },
    groups: { 'eu.json': { id: 'eu', name: 'European Union', members: ['DE', 'NL'], sources: [SOURCE], checkedOn: TODAY } },
    technologies: {
      'postgresql.json': {
        id: 'postgresql',
        name: 'PostgreSQL',
        parts: ['database'],
        about: 'A relational database.',
        sources: { docs: SOURCE },
        facts: [
          { kind: 'licence', value: 'PostgreSQL', sources: ['docs'], checkedOn: TODAY },
          {
            kind: 'support',
            value: { latestRelease: { version: '19.0', date: '2026-11-19' }, endOfSupport: '2031-11-19' },
            sources: ['docs'],
            checkedOn: TODAY,
          },
        ],
      },
      'cloud.json': {
        id: 'cloud',
        name: 'A cloud',
        parts: ['hosting'],
        about: 'A hosting provider.',
        sources: { regions: SOURCE, databases: { ...SOURCE, url: 'https://example.org/db' } },
        facts: [
          {
            kind: 'regions',
            value: [
              { country: 'ZA', region: 'Johannesburg' },
              { country: 'NL', region: 'Amsterdam' },
            ],
            sources: ['regions'],
            checkedOn: TODAY,
          },
          {
            kind: 'available-in',
            value: { everywhereExcept: ['DE'] },
            sources: ['regions'],
            checkedOn: TODAY,
            note: 'For illustration.',
          },
          { kind: 'compliance', value: [], sources: ['regions'], checkedOn: TODAY },
          { kind: 'host-databases', value: ['postgresql'], sources: ['databases'], checkedOn: TODAY },
          { kind: 'sdks', value: { languages: ['go'], httpsApi: true }, sources: ['regions', 'databases'], checkedOn: TODAY },
          { kind: 'requires', value: [{ part: 'back-end' }], sources: ['regions'], checkedOn: TODAY },
        ],
      },
    },
  };
}

const problemsOf = (files: CatalogueFiles) => {
  const result = validateCatalogue(files, TODAY);
  return result.ok ? [] : result.problems;
};

/** The valid catalogue with one change, expecting a problem that mentions `expected`. */
function refuses(change: (f: ReturnType<typeof valid>) => void, expected: string | RegExp) {
  const files = valid();
  change(files);
  const problems = problemsOf(files);
  expect(problems.join('\n')).toMatch(expected);
}
const cloud = (f: ReturnType<typeof valid>) =>
  f.technologies['cloud.json'] as { facts: Record<string, unknown>[]; sources: Record<string, unknown> };
const pg = (f: ReturnType<typeof valid>) =>
  f.technologies['postgresql.json'] as { facts: Record<string, unknown>[] } & Record<string, unknown>;

describe('the catalogue check', () => {
  it('accepts a valid catalogue and builds it in the catalogue’s own order', () => {
    const result = validateCatalogue(valid(), TODAY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.catalogue.version).toBe(1);
    expect(result.catalogue.technologies.map((t) => t.id)).toEqual(['postgresql', 'cloud']);
    expect(result.catalogue.groups.map((g) => g.id)).toEqual(['eu']);
  });

  it('refuses a duplicate or missing id in the order, and a file named after another id', () => {
    refuses(
      (f) => ((f.manifest as { order: string[] }).order = ['postgresql', 'postgresql', 'cloud']),
      'lists "postgresql" twice',
    );
    refuses((f) => ((f.manifest as { order: string[] }).order = ['postgresql']), 'doesn\'t list "cloud"');
    refuses((f) => ((f.manifest as { order: string[] }).order = ['postgresql', 'cloud', 'ghost']), '"ghost", which has no file');
    refuses((f) => (pg(f).id = 'postgres'), 'named after it');
  });

  it('refuses an unknown part or kind of fact, and a kind twice', () => {
    refuses((f) => (pg(f).parts = ['database', 'queue']), '"queue" isn\'t a part');
    refuses(
      (f) => pg(f).facts.push({ kind: 'popularity', value: 'high', sources: ['docs'], checkedOn: TODAY }),
      '"popularity" isn\'t a kind of fact',
    );
    refuses(
      (f) => pg(f).facts.push({ kind: 'licence', value: 'MIT', sources: ['docs'], checkedOn: TODAY }),
      'at most one licence fact',
    );
  });

  it('refuses values outside the vocabularies', () => {
    refuses((f) => (pg(f).facts[0].value = 'WTFPL'), 'SPDX id');
    refuses(
      (f) => pg(f).facts.push({ kind: 'languages', value: ['cobol'], sources: ['docs'], checkedOn: TODAY }),
      "cobol isn't among the languages",
    );
    refuses(
      (f) => pg(f).facts.push({ kind: 'offline', value: 'mostly', sources: ['docs'], checkedOn: TODAY }),
      'yes, partly or no',
    );
    refuses((f) => (cloud(f).facts[2].value = ['gdpr']), "gdpr isn't among the compliance claims");
  });

  it('refuses a source that isn’t https, a fact without a source, an unlisted source and an unused one', () => {
    refuses((f) => (cloud(f).sources.regions = { ...SOURCE, url: 'http://example.org/regions' }), 'https address');
    refuses((f) => (pg(f).facts[0].sources = []), 'at least one source');
    refuses((f) => (pg(f).facts[0].sources = ['blog']), 'source "blog", which its technology doesn\'t list');
    refuses((f) => ((pg(f).sources as Record<string, unknown>).extra = SOURCE), 'source "extra" isn\'t used');
  });

  it('refuses a date after today, or not a real date, anywhere', () => {
    refuses((f) => (pg(f).facts[0].checkedOn = '2026-11-25'), 'after today');
    refuses((f) => (pg(f).facts[0].checkedOn = '2026-02-30'), 'real date');
    refuses((f) => ((f.manifest as { date: string }).date = '2026-12-01'), 'CATALOGUE.json: date (2026-12-01) is after today');
    refuses((f) => ((f.countries as { checkedOn: string }).checkedOn = '2027-01-01'), 'countries.json: checkedOn');
    refuses((f) => ((f.groups['eu.json'] as { checkedOn: string }).checkedOn = '2027-01-01'), 'groups/eu.json: checkedOn');
    refuses(
      (f) => (pg(f).facts[1].value = { latestRelease: { version: '20.0', date: '2027-01-01' } }),
      'latest release (2027-01-01) is after today',
    );
  });

  it('refuses a country code not officially assigned, in a region, a list, an exception or a group', () => {
    refuses(
      (f) => (cloud(f).facts[0].value = [{ country: 'XX', region: 'Nowhere' }]),
      '"XX", which isn\'t an officially assigned',
    );
    refuses((f) => (cloud(f).facts[1].value = { countries: ['za'] }), '"za"');
    refuses((f) => (cloud(f).facts[1].value = { everywhereExcept: ['UK'] }), '"UK"');
    refuses((f) => ((f.groups['eu.json'] as { members: string[] }).members = ['DE', 'EU']), 'groups/eu.json: members has "EU"');
    refuses((f) => ((f.countries as { codes: string[] }).codes = ['ZA', 'DE']), 'alphabetical order');
  });

  it('refuses a reference that doesn’t resolve, and a host database that isn’t a database', () => {
    refuses((f) => (cloud(f).facts[3].value = ['mysql']), '"mysql", which isn\'t in the catalogue');
    refuses((f) => (cloud(f).facts[3].value = ['cloud']), '"cloud", which isn\'t a database');
    refuses((f) => (cloud(f).facts[5].value = [{ technology: 'kafka' }]), 'requires "kafka"');
    refuses((f) => (cloud(f).facts[5].value = [{ part: 'queue' }]), '{ "technology": <id> } or { "part": <part> }');
  });

  it('refuses a stray field, such as an evidence quote left in', () => {
    refuses((f) => (pg(f).facts[0].evidence = 'copied text'), 'a field it shouldn\'t: "evidence"');
    refuses((f) => (pg(f).leftOut = []), '"leftOut"');
  });

  it('refuses a version or date missing from the manifest', () => {
    refuses((f) => ((f.manifest as { version: unknown }).version = 0), 'whole number');
    refuses((f) => delete (f.manifest as { date?: string }).date, 'CATALOGUE.json: date must be a real date');
  });

  it('reports every problem, each with its file', () => {
    const files = valid();
    pg(files).facts[0].value = 'WTFPL';
    cloud(files).facts[0].value = [{ country: 'XX', region: 'Nowhere' }];
    const problems = problemsOf(files);
    expect(problems.some((p) => p.startsWith('technologies/postgresql.json:'))).toBe(true);
    expect(problems.some((p) => p.startsWith('technologies/cloud.json:'))).toBe(true);
  });
});

describe('dates', () => {
  it('knows a real date', () => {
    expect(isRealDate('2028-02-29')).toBe(true);
    for (const d of ['2026-02-29', '2026-13-01', '26-11-24', '2026-11-24T00:00:00Z']) expect(isRealDate(d), d).toBe(false);
  });

  it('takes today as the latest date anywhere on Earth, so a fact read today passes wherever the check runs', () => {
    // 23:30 on 24 November in Johannesburg is 21:30 UTC, already 25 November at UTC+14.
    expect(latestToday(new Date('2026-11-24T21:30:00Z'))).toBe('2026-11-25');
    expect(latestToday(new Date('2026-11-24T09:00:00Z'))).toBe('2026-11-24');
  });
});
