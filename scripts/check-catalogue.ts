/**
 * `npm run check:catalogue` (Workspace Phase 5, WP2): fails if the technology catalogue in `catalogue/` breaks its
 * rules: unknown parts, kinds or values, a fact without an https source or with a date after today, a country code
 * that isn't officially assigned, a reference that doesn't resolve, a technology missing from the order. The rules
 * are in `src/catalogue/validate.ts`.
 */
import { readCatalogueFiles } from './catalogue-files.ts';
import { latestToday, validateCatalogue } from '../src/catalogue/validate.ts';

const { files, problems: unreadable } = readCatalogueFiles('catalogue');
const result = validateCatalogue(files, latestToday());
const problems = [...unreadable, ...(result.ok ? [] : result.problems)];
if (problems.length) {
  console.error(`Catalogue check: ${problems.length} problem${problems.length === 1 ? '' : 's'}.`);
  for (const p of problems) console.error(`  catalogue/${p}`);
  process.exit(1);
}
if (!result.ok) process.exit(1);
const facts = result.catalogue.technologies.reduce((n, t) => n + t.facts.length, 0);
console.log(
  `Catalogue check: version ${result.catalogue.version} of ${result.catalogue.date}, ${result.catalogue.technologies.length} technologies, ${facts} facts, ${result.catalogue.groups.length} groups of countries, nothing found.`,
);
