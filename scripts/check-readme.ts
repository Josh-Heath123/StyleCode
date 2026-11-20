/**
 * `npm run check:readme` (docs/presentation/PRESENTATION-BRIEF.md, P7): fails if a relative link, image or anchor in a
 * tracked Markdown file doesn't resolve, if a figure the README quotes from research isn't beside a link to its section
 * or isn't in it, or if the README names a count that drifts. The rules are in `scripts/readme.ts`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { linkProblems, readmeProblems } from './readme.ts';

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const files = new Set(tracked);
// Folders count as existing when a tracked file is inside them.
const exists = (path: string) => files.has(path) || tracked.some((f) => f.startsWith(`${path.replace(/\/$/, '')}/`));
const read = (path: string) => readFileSync(path, 'utf8');

const markdown = tracked.filter((f) => f.endsWith('.md') && existsSync(f));
const problems = [
  ...markdown.flatMap((f) => linkProblems(f, read(f), exists, read)),
  ...readmeProblems('README.md', read('README.md'), read),
];
if (problems.length) {
  console.error(`README check: ${problems.length} problem${problems.length === 1 ? '' : 's'}.`);
  for (const p of problems) console.error(`  ${p.file}:${p.line}: ${p.message}`);
  process.exit(1);
}
console.log(`README check: ${markdown.length} Markdown files, nothing found.`);
