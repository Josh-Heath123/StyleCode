/**
 * `npm run check:tokens` (docs/brand/IDENTITY.md, I6): fails if app chrome sets a colour outside app.css's tokens,
 * uses the AI's orange outside what shows the AI's work, or pairs a text colour with a ground the identity's contrast
 * rules forbid. The rules are in `scripts/tokens.ts`.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { isChrome, tokenProblems } from './tokens.ts';

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter((path) => path && isChrome(path));

const problems = files.flatMap((path) => tokenProblems(path, readFileSync(path, 'utf8')));
if (problems.length) {
  console.error(`Token check: ${problems.length} problem${problems.length === 1 ? '' : 's'}.`);
  for (const p of problems) console.error(`  ${p.file}:${p.line}: ${p.message}`);
  process.exit(1);
}
console.log(`Token check: ${files.length} files of app chrome, nothing found.`);
