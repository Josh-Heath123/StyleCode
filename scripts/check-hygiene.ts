/**
 * `npm run check:hygiene` (repository brief, R3): fails if the repository holds anything it never should: audio,
 * video or archives, a file over the size limit, a user's folder, an email address other than GitHub's noreply ones
 * and those at domains reserved for examples, a likely secret, a .env file, or an action or image that isn't pinned.
 *
 * Every tracked file is checked. On a pull request, CI also passes its base and head (HYGIENE_BASE, HYGIENE_HEAD).
 * Then every file any of its commits adds or changes is checked too, so something added and deleted again within the
 * pull request still fails it; a merge would keep it in main's history. Each commit's author and committer must be
 * GitHub noreply addresses, and its message must hold no user folder, address or secret. The rules are in
 * `scripts/hygiene.ts`.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { commitProblems, fileProblems } from './hygiene.ts';

const MAX = 1024 * 1024 * 1024;
const git = (args: string[], input?: string) => execFileSync('git', args, { maxBuffer: MAX, input });
const gitText = (...args: string[]) => git(args).toString('utf8');

const failures: string[] = [];

// Every tracked file, as it is in the working tree, with the blob git has for it.
const tracked = new Map<string, string>(); // blob → path
let files = 0;
for (const entry of gitText('ls-files', '-s', '-z').split('\0').filter(Boolean)) {
  const [meta, path] = entry.split('\t');
  const blob = meta.split(' ')[1];
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch {
    continue; // Deleted in the working tree: nothing to check.
  }
  tracked.set(blob, path);
  files++;
  for (const p of fileProblems(path, bytes)) failures.push(`${path}: ${p}`);
}

const base = process.env.HYGIENE_BASE;
const head = process.env.HYGIENE_HEAD;
let commits = 0;
let earlier = 0;
if (base && head) {
  const range = `${base}..${head}`;
  const log = gitText('log', '--format=%H%x00%ae%x00%ce%x00%B%x1e', range);
  for (const record of log.split('\x1e')) {
    const [sha, authorEmail, committerEmail, message] = record.replace(/^\n/, '').split('\0');
    if (!sha) continue;
    commits++;
    for (const p of commitProblems({ sha, authorEmail, committerEmail, message: message ?? '' }))
      failures.push(`commit ${sha.slice(0, 7)}: ${p}`);
  }

  // Every file the commits add or change, including ones a later commit changes again or deletes.
  const added = new Map<string, string>(); // blob → path
  let commit = '';
  for (const line of gitText('log', '--raw', '--no-renames', '--no-abbrev', '-m', '--format=%x01%H', range).split('\n')) {
    if (line.startsWith('\x01')) commit = line.slice(1, 8);
    const raw = /^:\d+ (\d+) [0-9a-f]+ ([0-9a-f]+) ([AMT])\t(.+)$/.exec(line);
    if (!raw || raw[1] === '160000') continue; // Not added or changed, or a submodule.
    const [, , blob, , path] = raw;
    if (!tracked.has(blob) && !added.has(blob)) added.set(blob, `${path} (in commit ${commit})`);
  }
  if (added.size) {
    const out = git(['cat-file', '--batch'], [...added.keys()].join('\n') + '\n');
    let at = 0;
    while (at < out.length) {
      const end = out.indexOf(10, at);
      const [blob, , size] = out.subarray(at, end).toString().split(' ');
      const bytes = out.subarray(end + 1, end + 1 + Number(size));
      at = end + 1 + Number(size) + 1;
      const where = added.get(blob)!;
      earlier++;
      for (const p of fileProblems(where.replace(/ \(in commit [0-9a-f]+\)$/, ''), bytes)) failures.push(`${where}: ${p}`);
    }
  }
}

if (failures.length) {
  console.error(`Hygiene check: ${failures.length} problem${failures.length === 1 ? '' : 's'}.`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(
  `Hygiene check: ${files} files${base && head ? `, ${commits} commits and ${earlier} earlier versions of files` : ''}, nothing found.`,
);
