/**
 * `npm run check:hygiene` (repository brief, R3): fails if the repository holds anything it never should: audio,
 * video or archives, a file over the size limit, a user's folder, an email address other than GitHub's noreply ones,
 * a likely secret, a .env file, or an action not pinned to a full commit SHA.
 *
 * Every tracked file is checked. On a pull request, CI also passes its base and head (HYGIENE_BASE, HYGIENE_HEAD),
 * and each of its commits is checked: noreply author and committer addresses, and no user folder or address in its
 * message. The rules are in `scripts/hygiene.ts`.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { commitProblems, isBinary, pathProblems, textProblems } from './hygiene.ts';

const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

const failures: string[] = [];
const files = git('ls-files', '-z').split('\0').filter(Boolean);

for (const path of files) {
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    continue; // Deleted in the working tree: nothing to check.
  }
  const problems = pathProblems(path, size);
  const bytes = readFileSync(path);
  if (!isBinary(bytes)) problems.push(...textProblems(path, bytes.toString('utf8')));
  for (const p of problems) failures.push(`${path}: ${p}`);
}

const base = process.env.HYGIENE_BASE;
const head = process.env.HYGIENE_HEAD;
let commits = 0;
if (base && head) {
  const log = git('log', '--format=%H%x00%ae%x00%ce%x00%B%x1e', `${base}..${head}`);
  for (const record of log.split('\x1e')) {
    const [sha, authorEmail, committerEmail, message] = record.replace(/^\n/, '').split('\0');
    if (!sha) continue;
    commits++;
    for (const p of commitProblems({ sha, authorEmail, committerEmail, message: message ?? '' }))
      failures.push(`commit ${sha.slice(0, 7)}: ${p}`);
  }
}

if (failures.length) {
  console.error(`Hygiene check: ${failures.length} problem${failures.length === 1 ? '' : 's'}.`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`Hygiene check: ${files.length} files${base && head ? ` and ${commits} commits` : ''}, nothing found.`);
