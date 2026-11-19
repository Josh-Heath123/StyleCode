/**
 * `npm run check:dependencies` (repository brief, R4): on a pull request, fails if `dependencies` in package.json
 * gains an entry, unless the pull request carries the label `dependency-approved`, which only the owner adds.
 * CI passes the base commit (DEPENDENCIES_BASE) and whether the label is on (DEPENDENCY_APPROVED=true). It runs in
 * its own workflow, which runs again when labels change.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { addedDependencies } from './hygiene.ts';

const base = process.env.DEPENDENCIES_BASE;
if (!base) {
  console.error('Set DEPENDENCIES_BASE to the pull request’s base commit.');
  process.exit(2);
}
const before = execFileSync('git', ['show', `${base}:package.json`], { encoding: 'utf8' });
const added = addedDependencies(before, readFileSync('package.json', 'utf8'));
const approved = process.env.DEPENDENCY_APPROVED === 'true';

if (added.length === 0) console.log('No new runtime dependencies.');
else if (approved) console.log(`New runtime dependencies, approved by the owner’s label: ${added.join(', ')}.`);
else {
  console.error(
    `New runtime dependencies: ${added.join(', ')}. Each needs the owner’s approval: the label dependency-approved on this pull request.`,
  );
  process.exit(1);
}
