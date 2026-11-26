/**
 * Draws catalogue facts at random, from a seed, for the reviewer to check against their sources at a catalogue
 * check-in (Workspace Phase 5, WP3). Pure: `npm run sample:catalogue` (`sample-catalogue.ts`) reads the files and
 * prints the table. The same seed always draws the same facts from the same catalogue, on every machine.
 */
import type { Catalogue, Fact, Technology } from '../src/catalogue/types.ts';

/** Place and compliance facts (decision 27): at least `placeCount` of a sample are these. */
export const PLACE_KINDS: ReadonlySet<string> = new Set(['regions', 'available-in', 'compliance']);

/** A small, well-known seeded generator (mulberry32): the same seed gives the same numbers on every machine. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `count` items from `items` without repeats, in the order drawn. */
export function draw<T>(items: readonly T[], count: number, random: () => number): T[] {
  const pool = [...items];
  const out: T[] = [];
  while (out.length < count && pool.length) out.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
  return out;
}

export interface Drawn {
  tech: Technology;
  fact: Fact;
}

/**
 * `count` facts: `placeCount` place or compliance facts first (or all there are), then the rest from every other
 * fact, drawn in the catalogue's own order so the result doesn't depend on how the files were read.
 */
export function sampleFacts(catalogue: Catalogue, seed: number, count: number, placeCount: number): Drawn[] {
  const all = catalogue.technologies.flatMap((tech) => tech.facts.map((fact) => ({ tech, fact })));
  const random = seeded(seed);
  const places = draw(
    all.filter((x) => PLACE_KINDS.has(x.fact.kind)),
    Math.min(placeCount, count),
    random,
  );
  const rest = draw(
    all.filter((x) => !PLACE_KINDS.has(x.fact.kind)),
    count - places.length,
    random,
  );
  return [...places, ...rest];
}

/** The sample as a Markdown table, each fact with its value as stored and its sources' URLs. */
export function sampleTable(catalogue: Catalogue, seed: number, drawn: readonly Drawn[]): string {
  const cell = (s: string) => s.replace(/\|/g, '\\|');
  const lines = [
    `Seed ${seed}, catalogue version ${catalogue.version} of ${catalogue.date}: ${drawn.length} facts, ${
      drawn.filter((d) => PLACE_KINDS.has(d.fact.kind)).length
    } of them place or compliance.`,
    '',
    '| # | Technology | Kind | Value as stored | Checked on | Sources |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  drawn.forEach(({ tech, fact }, i) => {
    const urls = fact.sources.map((key) => tech.sources[key].url).join('<br>');
    lines.push(
      `| ${i + 1} | ${tech.id} | ${fact.kind} | \`${cell(JSON.stringify(fact.value))}\` | ${fact.checkedOn} | ${urls} |`,
    );
  });
  return lines.join('\n');
}
