import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { commitRange } from './hygiene.ts';

/**
 * The hygiene runner over a made-up repository in a temporary folder, as CI runs it on a push to main: the range is
 * the commit main was at before and the one it's at now. The identities are made up, and built when the tests run,
 * so this file holds no address the check itself would find.
 */
const at = '@';
const noreply = { name: 'Made Up', email: `12345678+made-up-name${at}users.noreply.github.com` };
const github = { name: 'GitHub', email: `noreply${at}github.com` };
const personal = { name: 'Made Up', email: `pat.example.user${at}mailhost.co.za` };
const script = resolve('scripts/check-hygiene.ts');

let repo: string;
const git = (args: string[], who = noreply, committer = who) =>
  execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], {
    cwd: repo,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: who.name,
      GIT_AUTHOR_EMAIL: who.email,
      GIT_COMMITTER_NAME: committer.name,
      GIT_COMMITTER_EMAIL: committer.email,
    },
  })
    .toString()
    .trim();
const commit = (file: string, who = noreply, committer = who) => {
  writeFileSync(join(repo, file), `${file}\n`);
  git(['add', file], who, committer);
  git(['commit', '-q', '-m', `Add ${file}`], who, committer);
  return git(['rev-parse', 'HEAD']);
};
/** A merge as GitHub's website makes one: the merger as author, GitHub as committer. */
const merge = (branch: string, who: typeof noreply) => {
  git(['merge', '-q', '--no-ff', '-m', `Merge pull request from ${branch}`, branch], who, github);
  return git(['rev-parse', 'HEAD']);
};
const check = (base: string, head: string) => {
  const run = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', script], {
    cwd: repo,
    env: { ...process.env, HYGIENE_BASE: base, HYGIENE_HEAD: head },
    encoding: 'utf8',
  });
  return { status: run.status, out: run.stdout + run.stderr };
};

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'hygiene-push-'));
  git(['init', '-q', '-b', 'main']);
});
afterAll(() => rmSync(repo, { recursive: true, force: true }));

describe('the hygiene check on a push to main', () => {
  it('passes a merge whose author and committer are noreply addresses', () => {
    const before = commit('a.txt');
    git(['switch', '-q', '-c', 'good']);
    commit('b.txt');
    git(['switch', '-q', 'main']);
    const after = merge('good', noreply);
    const { status, out } = check(before, after);
    expect(out).toContain('2 commits');
    expect(status, out).toBe(0);
  });

  it('turns main red when a merge made on the website carries a personal address', () => {
    const before = git(['rev-parse', 'HEAD']);
    git(['switch', '-q', '-c', 'bad-merge']);
    commit('c.txt');
    git(['switch', '-q', 'main']);
    const after = merge('bad-merge', personal);
    const { status, out } = check(before, after);
    expect(status).toBe(1);
    expect(out).toContain(`commit ${after.slice(0, 7)}: its author’s email isn’t a GitHub noreply address`);
    expect(out).not.toContain(personal.email);
  });

  it('turns main red for a pushed commit whose committer has a personal address', () => {
    const before = git(['rev-parse', 'HEAD']);
    const after = commit('d.txt', noreply, personal);
    const { status, out } = check(before, after);
    expect(status).toBe(1);
    expect(out).toContain(`commit ${after.slice(0, 7)}: its committer’s email isn’t a GitHub noreply address`);
  });

  it('checks only the pushed commits, and none when the push created the branch', () => {
    const before = git(['rev-parse', 'HEAD']);
    const after = commit('e.txt');
    expect(check(before, after).status).toBe(0);
    const created = check('0'.repeat(40), after);
    expect(created.out).not.toContain('commits');
    expect(created.status).toBe(0);
  });
});

describe('commitRange', () => {
  it('is the range from base to head, and none without both or for a new branch', () => {
    expect(commitRange('a'.repeat(40), 'b'.repeat(40))).toBe(`${'a'.repeat(40)}..${'b'.repeat(40)}`);
    expect(commitRange('0'.repeat(40), 'b'.repeat(40))).toBeNull();
    expect(commitRange('0'.repeat(64), 'b'.repeat(64))).toBeNull();
    expect(commitRange('', 'b'.repeat(40))).toBeNull();
    expect(commitRange(undefined, undefined)).toBeNull();
    expect(commitRange('a'.repeat(40), '')).toBeNull();
  });
});
