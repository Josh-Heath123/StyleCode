import { describe, expect, it } from 'vitest';
import type { Catalogue, Fact, Technology } from '../src/catalogue/types.ts';
import { PLACE_KINDS, draw, sampleFacts, sampleTable, seeded } from './catalogue-sample.ts';

const source = { title: 'Docs', publisher: 'Vendor', url: 'https://example.org/docs' };
const fact = (kind: Fact['kind'], value: unknown): Fact => ({ kind, value, sources: ['docs'], checkedOn: '2026-11-26' }) as Fact;

/** Ten technologies, each with three place or compliance facts and three others: 30 of each. */
function catalogue(): Catalogue {
  const technologies: Technology[] = Array.from({ length: 10 }, (_, i) => ({
    id: `tech-${i}`,
    name: `Tech ${i}`,
    parts: ['hosting'],
    about: 'A host.',
    sources: { docs: source },
    facts: [
      fact('regions', [{ country: 'ZA', region: `Region ${i}` }]),
      fact('available-in', { countries: ['NL'] }),
      fact('compliance', ['iso-27001']),
      fact('offering', 'paid-service'),
      fact('managed-service', true),
      fact('host-runtimes', ['node']),
    ],
  }));
  const countries = { codes: ['NL', 'ZA'], source, checkedOn: '2026-11-26' };
  return { version: 1, date: '2026-11-26', technologies, countries, groups: [] };
}

const key = (d: { tech: Technology; fact: Fact }) => `${d.tech.id}/${d.fact.kind}`;

describe('the catalogue sample', () => {
  it('gives the same numbers for the same seed, and different ones for another', () => {
    const a = seeded(20261126);
    const b = seeded(20261126);
    const first = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(first);
    expect(first.every((n) => n >= 0 && n < 1)).toBe(true);
    expect(seeded(1)()).not.toBe(first[0]);
  });

  it('draws without repeats, and no more than there are', () => {
    const items = [1, 2, 3, 4, 5];
    const drawn = draw(items, 3, seeded(7));
    expect(new Set(drawn).size).toBe(3);
    expect(drawn.every((n) => items.includes(n))).toBe(true);
    expect([...draw(items, 9, seeded(7))].sort()).toEqual(items);
  });

  it('draws the place and compliance facts asked for first, then the rest, with none twice', () => {
    const drawn = sampleFacts(catalogue(), 20261126, 40, 12);
    expect(drawn).toHaveLength(40);
    expect(new Set(drawn.map(key)).size).toBe(40);
    expect(drawn.slice(0, 12).every((d) => PLACE_KINDS.has(d.fact.kind))).toBe(true);
    expect(drawn.slice(12).every((d) => !PLACE_KINDS.has(d.fact.kind))).toBe(true);
  });

  it('draws the same facts from the same seed, and others from another seed', () => {
    const once = sampleFacts(catalogue(), 20261126, 20, 12).map(key);
    expect(sampleFacts(catalogue(), 20261126, 20, 12).map(key)).toEqual(once);
    expect(sampleFacts(catalogue(), 42, 20, 12).map(key)).not.toEqual(once);
  });

  it('takes every place fact there is when there are fewer than asked, and fills up with others', () => {
    const small = catalogue();
    small.technologies = small.technologies.slice(0, 2);
    const drawn = sampleFacts(small, 1, 10, 8);
    expect(drawn.filter((d) => PLACE_KINDS.has(d.fact.kind))).toHaveLength(6);
    expect(drawn).toHaveLength(10);
  });

  it('prints each fact with its value as stored and its source URL', () => {
    const c = catalogue();
    const table = sampleTable(c, 5, sampleFacts(c, 5, 4, 2));
    expect(table).toContain('Seed 5, catalogue version 1 of 2026-11-26: 4 facts, 2 of them place or compliance.');
    expect(table.split('\n').filter((l) => l.startsWith('| ') && /^\| \d/.test(l))).toHaveLength(4);
    expect(table).toContain('https://example.org/docs');
  });
});
