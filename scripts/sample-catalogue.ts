/**
 * `npm run sample:catalogue -- <seed> [count] [placeCount]`: prints `count` catalogue facts (40 by default) drawn
 * from a seed, at least `placeCount` of them (12 by default) place or compliance facts (decision 27), as a Markdown
 * table for the reviewer to check against the sources (Workspace Phase 5, WP3). The drawing is in
 * `catalogue-sample.ts`.
 */
import { readCatalogueFiles } from './catalogue-files.ts';
import { sampleFacts, sampleTable } from './catalogue-sample.ts';
import { latestToday, validateCatalogue } from '../src/catalogue/validate.ts';

const [seedArg, countArg = '40', placeArg = '12'] = process.argv.slice(2);
const [seed, count, placeCount] = [Number(seedArg), Number(countArg), Number(placeArg)];
if (![seed, count, placeCount].every(Number.isInteger) || count < 1 || placeCount < 0) {
  console.error('Give a whole-number seed: npm run sample:catalogue -- <seed> [count] [placeCount]');
  process.exit(1);
}
const { files, problems } = readCatalogueFiles('catalogue');
const result = validateCatalogue(files, latestToday());
if (problems.length || !result.ok) {
  console.error('The catalogue has problems; run npm run check:catalogue first.');
  process.exit(1);
}
console.log(sampleTable(result.catalogue, seed, sampleFacts(result.catalogue, seed, count, placeCount)));
