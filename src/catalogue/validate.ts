import type { Catalogue, CountryGroup, Countries, Fact, Manifest, Source, Technology } from './types.ts';
import {
  COMPLIANCE,
  FACT_KINDS,
  LANGUAGES,
  LICENCES,
  OFFERINGS,
  OFFLINE,
  PARTS,
  PLATFORMS,
  RUNTIMES,
  type FactKind,
} from './vocabulary.ts';

/**
 * Checks the catalogue's files (Workspace Phase 5, WP2; decisions 4, 7, 10 and 27) and builds the catalogue from them.
 * Pure: the files come in as parsed JSON by name, and `today` is the latest date anywhere on Earth (`latestToday`),
 * so a fact read today passes wherever the check runs, and nothing dated later does. Every problem is reported, each
 * with its file, not only the first.
 */

export interface CatalogueFiles {
  /** `CATALOGUE.json`. */
  manifest: unknown;
  /** `countries.json`. */
  countries: unknown;
  /** `technologies/<id>.json`, by file name. */
  technologies: Record<string, unknown>;
  /** `groups/<id>.json`, by file name. */
  groups: Record<string, unknown>;
}

export type CatalogueResult = { ok: true; catalogue: Catalogue } | { ok: false; problems: string[] };

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CODE = /^[A-Z]{2}$/;
const NOTE_MAX = 300;

/** Today's date at the far end of the date line (UTC+14): no place on Earth has a later one. */
export function latestToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 14 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** A real date, written YYYY-MM-DD: 2026-02-30 isn't one. */
export function isRealDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '' && v === v.trim();

export function validateCatalogue(files: CatalogueFiles, today: string): CatalogueResult {
  const problems: string[] = [];
  const report = (file: string, message: string) => problems.push(`${file}: ${message}`);

  /** Only these fields, so a misspelt or stray one (an evidence quote, say) is caught. */
  const onlyFields = (file: string, where: string, value: Record<string, unknown>, allowed: readonly string[]) => {
    for (const key of Object.keys(value))
      if (!allowed.includes(key)) report(file, `${where} has a field it shouldn't: "${key}".`);
  };
  const date = (file: string, where: string, value: unknown): value is string => {
    if (!isRealDate(value)) return (void report(file, `${where} must be a real date, YYYY-MM-DD.`), false);
    if (value > today) return (void report(file, `${where} (${value}) is after today.`), false);
    return true;
  };
  const source = (file: string, where: string, value: unknown): value is Source => {
    if (!isObject(value)) return (void report(file, `${where} must be a source: a title, a publisher and an https URL.`), false);
    onlyFields(file, where, value, ['title', 'publisher', 'url']);
    let good = true;
    if (!isText(value.title)) good = (report(file, `${where} needs a title.`), false);
    if (!isText(value.publisher)) good = (report(file, `${where} needs a publisher.`), false);
    let url: URL | null = null;
    try {
      url = typeof value.url === 'string' ? new URL(value.url) : null;
    } catch {
      url = null;
    }
    if (!url || url.protocol !== 'https:' || url.username || url.password)
      good = (report(file, `${where}'s URL must be an https address.`), false);
    return good;
  };
  const codes = (
    file: string,
    where: string,
    value: unknown,
    known: ReadonlySet<string>,
    allowEmpty = false,
  ): value is string[] => {
    if (!Array.isArray(value) || (!allowEmpty && value.length === 0))
      return (void report(file, `${where} must be a list of ISO 3166-1 alpha-2 codes.`), false);
    let good = true;
    for (const code of value)
      if (typeof code !== 'string' || !CODE.test(code) || (known.size > 0 && !known.has(code)))
        good =
          (report(file, `${where} has "${String(code)}", which isn't an officially assigned ISO 3166-1 alpha-2 code.`), false);
    if (new Set(value).size !== value.length) good = (report(file, `${where} names a country twice.`), false);
    return good;
  };

  // The officially assigned codes come first: every other place is checked against them.
  let countries: Countries | null = null;
  const knownCodes = new Set<string>();
  {
    const file = 'countries.json';
    const c = files.countries;
    if (!isObject(c)) report(file, 'must be an object with codes, a source and the date it was checked.');
    else {
      onlyFields(file, 'The file', c, ['codes', 'source', 'checkedOn', 'note']);
      const good = [
        codes(file, 'codes', c.codes, knownCodes),
        source(file, 'source', c.source),
        date(file, 'checkedOn', c.checkedOn),
        c.note === undefined || isText(c.note) || (report(file, 'note must be text.'), false),
      ].every(Boolean);
      const list: unknown[] = Array.isArray(c.codes) ? c.codes : [];
      const sorted = list.every((code, i) => i === 0 || String(code) > String(list[i - 1]));
      if (!sorted) report(file, 'codes must be in alphabetical order.');
      if (good && sorted) {
        countries = c as unknown as Countries;
        for (const code of countries.codes) knownCodes.add(code);
      }
    }
  }
  // Without the official list (reported above), codes are checked for their form only, rather than every fact
  // reporting the same missing list.

  const groups: CountryGroup[] = [];
  for (const [name, g] of Object.entries(files.groups).sort(([a], [b]) => a.localeCompare(b))) {
    const file = `groups/${name}`;
    if (!isObject(g)) {
      report(file, 'must be an object.');
      continue;
    }
    onlyFields(file, 'The group', g, ['id', 'name', 'members', 'sources', 'checkedOn']);
    let good = true;
    if (typeof g.id !== 'string' || !ID.test(g.id) || name !== `${g.id}.json`)
      good = (report(file, `id must be lower case words joined by hyphens, and the file must be named after it.`), false);
    if (!isText(g.name)) good = (report(file, 'needs a name.'), false);
    if (!codes(file, 'members', g.members, knownCodes)) good = false;
    if (!Array.isArray(g.sources) || g.sources.length === 0) good = (report(file, 'needs at least one source.'), false);
    else g.sources.forEach((s, i) => (good = source(file, `sources[${i}]`, s) && good));
    if (!date(file, 'checkedOn', g.checkedOn)) good = false;
    if (good) groups.push(g as unknown as CountryGroup);
  }

  // Technologies: each on its own first, then the references between them.
  const technologies = new Map<string, Technology>();
  for (const [name, t] of Object.entries(files.technologies).sort(([a], [b]) => a.localeCompare(b))) {
    const file = `technologies/${name}`;
    const tech = checkTechnology(file, name, t);
    if (tech) technologies.set(tech.id, tech);
  }

  function checkTechnology(file: string, name: string, t: unknown): Technology | null {
    if (!isObject(t)) return (report(file, 'must be an object.'), null);
    onlyFields(file, 'The technology', t, ['id', 'name', 'parts', 'about', 'sources', 'facts']);
    let good = true;
    if (typeof t.id !== 'string' || !ID.test(t.id) || name !== `${t.id}.json`)
      good = (report(file, 'id must be lower case words joined by hyphens, and the file must be named after it.'), false);
    if (!isText(t.name)) good = (report(file, 'needs a name.'), false);
    if (!isText(t.about) || t.about.length > 200)
      good = (report(file, 'needs "about": one plain sentence, under 200 characters.'), false);
    if (!Array.isArray(t.parts) || t.parts.length === 0) good = (report(file, 'must fill at least one part.'), false);
    else {
      for (const part of t.parts)
        if (!(PARTS as readonly unknown[]).includes(part)) good = (report(file, `"${String(part)}" isn't a part.`), false);
      if (new Set(t.parts).size !== t.parts.length) good = (report(file, 'names a part twice.'), false);
    }
    const sourceKeys = new Set<string>();
    if (!isObject(t.sources) || Object.keys(t.sources).length === 0) good = (report(file, 'needs at least one source.'), false);
    else
      for (const [key, s] of Object.entries(t.sources)) {
        if (!ID.test(key)) good = (report(file, `source key "${key}" must be lower case words joined by hyphens.`), false);
        if (source(file, `source "${key}"`, s)) sourceKeys.add(key);
        else good = false;
      }
    const used = new Set<string>();
    const kinds = new Set<string>();
    if (!Array.isArray(t.facts)) good = (report(file, 'facts must be a list.'), false);
    else
      t.facts.forEach((f, i) => {
        const where = `fact ${i + 1}${isObject(f) && typeof f.kind === 'string' ? ` (${f.kind})` : ''}`;
        if (!checkFact(file, where, f, sourceKeys, used)) good = false;
        if (isObject(f) && typeof f.kind === 'string') {
          if (kinds.has(f.kind)) good = (report(file, `${where}: a technology has at most one ${f.kind} fact.`), false);
          kinds.add(f.kind);
        }
      });
    for (const key of sourceKeys) if (!used.has(key)) good = (report(file, `source "${key}" isn't used by any fact.`), false);
    return good ? (t as unknown as Technology) : null;
  }

  function checkFact(file: string, where: string, f: unknown, sourceKeys: ReadonlySet<string>, used: Set<string>): boolean {
    if (!isObject(f)) return (report(file, `${where} must be an object.`), false);
    onlyFields(file, where, f, ['kind', 'value', 'sources', 'checkedOn', 'note']);
    let good = true;
    if (!(FACT_KINDS as readonly unknown[]).includes(f.kind))
      return (report(file, `${where}: "${String(f.kind)}" isn't a kind of fact.`), false);
    if (!Array.isArray(f.sources) || f.sources.length === 0)
      good = (report(file, `${where} must name at least one source.`), false);
    else
      for (const key of f.sources) {
        if (typeof key !== 'string' || !sourceKeys.has(key))
          good = (report(file, `${where} names source "${String(key)}", which its technology doesn't list.`), false);
        else used.add(key);
      }
    if (!date(file, `${where}'s checkedOn`, f.checkedOn)) good = false;
    if (f.note !== undefined && (!isText(f.note) || f.note.length > NOTE_MAX))
      good = (report(file, `${where}'s note must be short text, under ${NOTE_MAX} characters.`), false);
    if (!checkValue(file, where, f.kind as FactKind, f.value)) good = false;
    return good;
  }

  function checkValue(file: string, where: string, kind: FactKind, v: unknown): boolean {
    const fail = (message: string) => (report(file, `${where}: ${message}`), false);
    const oneOf = (list: readonly string[], what: string) =>
      list.includes(v as string) ? true : fail(`the value must be ${what}.`);
    const listOf = (value: unknown, list: readonly string[], what: string, allowEmpty = false): boolean => {
      if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) return fail(`the value must be a list of ${what}.`);
      const bad = value.filter((x) => !list.includes(x as string));
      if (bad.length) return fail(`${bad.map(String).join(', ')} ${bad.length === 1 ? "isn't" : "aren't"} among the ${what}.`);
      if (new Set(value).size !== value.length) return fail('the list names something twice.');
      return true;
    };
    switch (kind) {
      case 'licence':
        return oneOf(Object.keys(LICENCES), 'an SPDX id in the catalogue’s list, or "proprietary"');
      case 'offering':
        return oneOf(OFFERINGS, 'open-source or paid-service');
      case 'languages':
        return listOf(v, LANGUAGES, 'languages');
      case 'runtimes':
      case 'host-runtimes':
        return listOf(v, RUNTIMES, 'runtimes');
      case 'platforms':
        return listOf(v, PLATFORMS, 'platforms');
      case 'offline':
        return oneOf(OFFLINE, 'yes, partly or no');
      case 'self-hostable':
      case 'managed-service':
        return typeof v === 'boolean' ? true : fail('the value must be true or false.');
      case 'compliance':
        return listOf(v, COMPLIANCE, 'compliance claims', true);
      case 'regions': {
        if (!Array.isArray(v) || v.length === 0) return fail('the value must be a list of regions.');
        let good = true;
        const seen = new Set<string>();
        v.forEach((r, i) => {
          if (!isObject(r) || !isText(r.region) || Object.keys(r).some((k) => k !== 'country' && k !== 'region'))
            good = fail(`region ${i + 1} must have a country and a region name, and nothing else.`);
          else {
            if (!codes(file, `${where}, region ${i + 1}`, [r.country], knownCodes)) good = false;
            const key = `${String(r.country)}\n${r.region}`;
            if (seen.has(key)) good = fail(`the region "${r.region}" is listed twice.`);
            seen.add(key);
          }
        });
        return good;
      }
      case 'available-in': {
        if (!isObject(v) || Object.keys(v).length !== 1)
          return fail('the value must be { "countries": [...] } or { "everywhereExcept": [...] }.');
        if ('countries' in v) return codes(file, `${where}'s countries`, v.countries, knownCodes);
        if ('everywhereExcept' in v) return codes(file, `${where}'s exceptions`, v.everywhereExcept, knownCodes);
        return fail('the value must be { "countries": [...] } or { "everywhereExcept": [...] }.');
      }
      case 'host-databases':
        if (!Array.isArray(v) || v.length === 0 || !v.every((x) => typeof x === 'string'))
          return fail('the value must be a list of the catalogue’s databases, by id.');
        if (new Set(v).size !== v.length) return fail('the list names something twice.');
        return true; // Resolved once every technology is read.
      case 'sdks': {
        if (!isObject(v) || typeof v.httpsApi !== 'boolean' || Object.keys(v).some((k) => k !== 'languages' && k !== 'httpsApi'))
          return fail('the value must be { "languages": [...], "httpsApi": true or false }.');
        return listOf(v.languages, LANGUAGES, 'languages', true);
      }
      case 'requires': {
        if (!Array.isArray(v) || v.length === 0) return fail('the value must be a list of what it requires.');
        let good = true;
        for (const r of v) {
          const isTech = isObject(r) && Object.keys(r).length === 1 && typeof r.technology === 'string';
          const isPart = isObject(r) && Object.keys(r).length === 1 && (PARTS as readonly unknown[]).includes(r.part);
          if (!isTech && !isPart) good = fail('each thing it requires is { "technology": <id> } or { "part": <part> }.');
        }
        return good;
      }
      case 'support': {
        if (!isObject(v) || !isObject(v.latestRelease))
          return fail('the value must give the latest release, its version and date.');
        let good = true;
        if (Object.keys(v).some((k) => k !== 'latestRelease' && k !== 'endOfSupport'))
          good = fail('the value has a field it shouldn’t.');
        const release = v.latestRelease;
        if (!isText(release.version) || Object.keys(release).some((k) => k !== 'version' && k !== 'date'))
          good = fail('the latest release needs a version and a date, and nothing else.');
        if (!date(file, `${where}'s latest release`, release.date)) good = false;
        if (v.endOfSupport !== undefined && !isRealDate(v.endOfSupport))
          good = fail('the end of support must be a real date, YYYY-MM-DD.');
        return good;
      }
    }
  }

  // References between technologies, now that every one is read.
  for (const tech of technologies.values()) {
    const file = `technologies/${tech.id}.json`;
    for (const fact of tech.facts as Fact[]) {
      if (fact.kind === 'host-databases')
        for (const id of fact.value) {
          const db = technologies.get(id);
          if (!db) report(file, `host-databases names "${id}", which isn't in the catalogue.`);
          else if (!db.parts.includes('database')) report(file, `host-databases names "${id}", which isn't a database.`);
        }
      if (fact.kind === 'requires')
        for (const r of fact.value)
          if ('technology' in r && !technologies.has(r.technology))
            report(file, `requires "${r.technology}", which isn't in the catalogue.`);
          else if ('technology' in r && r.technology === tech.id) report(file, 'requires itself.');
    }
  }

  // The manifest: version, date, and every technology once in the catalogue's order.
  let manifest: Manifest | null = null;
  {
    const file = 'CATALOGUE.json';
    const m = files.manifest;
    if (!isObject(m)) report(file, 'must be an object with the version, the date and the order.');
    else {
      onlyFields(file, 'The manifest', m, ['version', 'date', 'order']);
      let good = true;
      if (!Number.isInteger(m.version) || (m.version as number) < 1)
        good = (report(file, 'version must be a whole number, 1 or more.'), false);
      if (!date(file, 'date', m.date)) good = false;
      if (!Array.isArray(m.order)) good = (report(file, 'order must list every technology by id.'), false);
      else {
        const listed = new Set<string>();
        for (const id of m.order) {
          if (typeof id !== 'string' || !(`${id}.json` in files.technologies))
            good = (report(file, `order lists "${String(id)}", which has no file.`), false);
          else if (listed.has(id)) good = (report(file, `order lists "${id}" twice.`), false);
          else listed.add(id);
        }
        for (const name of Object.keys(files.technologies)) {
          const id = name.replace(/\.json$/, '');
          if (!listed.has(id)) good = (report(file, `order doesn't list "${id}".`), false);
        }
      }
      if (good) manifest = m as unknown as Manifest;
    }
  }

  if (problems.length > 0 || !manifest || !countries) return { ok: false, problems };
  const m = manifest as Manifest;
  return {
    ok: true,
    catalogue: {
      version: m.version,
      date: m.date,
      technologies: m.order.map((id) => technologies.get(id)!),
      countries,
      groups,
    },
  };
}
