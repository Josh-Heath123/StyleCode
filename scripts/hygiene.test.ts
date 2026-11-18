import { describe, expect, it } from 'vitest';
import {
  commitProblems,
  isBinary,
  isNoreply,
  pathProblems,
  personalProblems,
  secretProblems,
  SIZE_LIMIT,
  textProblems,
  workflowProblems,
  addedDependencies,
} from './hygiene.ts';

/**
 * The hygiene check's bad examples are made up, and built when the tests run, so this file holds no address, user
 * folder or key that the check itself would find.
 */
const at = '@';
const madeUpAddress = `pat.example.user${at}mailhost.co.za`;
const noreply = `12345678+made-up-name${at}users.noreply.github.com`;
const fakeKey = (prefix: string, length: number, alphabet = 'abcXYZ019') =>
  prefix + Array.from({ length }, (_, i) => alphabet[i % alphabet.length]).join('');
const sha = 'a'.repeat(40);
// A user's folder, spelt in pieces so this file doesn't hold one.
const [USERS, HOME] = ['Us' + 'ers', 'ho' + 'me'];

describe('files', () => {
  it('refuses audio, video, archives and .env files, at any depth', () => {
    for (const path of ['take.wav', 'docs/a.MP3', 'clip.mp4', 'old/backup.zip', 'x.tar.gz', 'models.7z', 'a/.env', '.env.local'])
      expect(pathProblems(path, 10), path).not.toEqual([]);
    for (const path of ['docs/media/demo.gif', 'src/app.ts', '.env.example', 'environment.ts', 'a.envelope'])
      expect(pathProblems(path, 10), path).toEqual([]);
  });

  it('refuses a file over the size limit', () => {
    expect(pathProblems('docs/big.png', SIZE_LIMIT + 1)).toEqual([expect.stringContaining('over the limit')]);
    expect(pathProblems('docs/big.png', SIZE_LIMIT)).toEqual([]);
  });

  it('tells binary files from text', () => {
    expect(isBinary(new Uint8Array([71, 73, 70, 0, 1]))).toBe(true);
    expect(isBinary(new TextEncoder().encode('plain text'))).toBe(false);
  });
});

describe('user folders and email addresses', () => {
  it('finds a user’s folder on Windows, macOS and Linux, written any way', () => {
    for (const text of [
      `C:\\${USERS}\\someone\\StyleCode`,
      `'D:\\\\${USERS}\\\\someone\\\\x'`,
      `c:/${USERS}/someone/file`,
      `at /${USERS}/someone/Desktop`,
      `"/${HOME}/someone/.ssh"`,
    ])
      expect(personalProblems(text), text).toEqual([expect.stringContaining('user’s folder')]);
  });

  it('lets placeholders and other paths through', () => {
    for (const text of ['C:\\Users\\<you>\\StyleCode Data', '`/Users/…`', 'https://site.example/home/page', '~/StyleCode Data'])
      expect(personalProblems(text), text).toEqual([]);
  });

  it('finds email addresses, but not GitHub’s noreply ones or reserved example domains', () => {
    expect(personalProblems(`write to ${madeUpAddress}`)).toEqual([expect.stringContaining('email address')]);
    expect(personalProblems(`Co-authored-by: Someone <someone${at}company.io>`)).toHaveLength(1);
    for (const ok of [noreply, `noreply${at}github.com`, `you${at}example.com`, `a${at}mail.test`, 'react@19.3.1'])
      expect(personalProblems(ok), ok).toEqual([]);
  });

  it('never repeats the whole address in its report', () => {
    expect(personalProblems(madeUpAddress)[0]).not.toContain(madeUpAddress);
  });
});

describe('secrets', () => {
  it('finds API keys, GitHub tokens, AWS keys and private keys', () => {
    for (const text of [
      fakeKey('sk-', 48),
      fakeKey('sk-ant-api03-', 90),
      fakeKey('ghp_', 36),
      fakeKey('github_pat_', 82),
      fakeKey('AKIA', 16, 'ABCDEFGHIJKLMNOP234567'),
      ['-----BEGIN', 'OPENSSH PRIVATE KEY-----'].join(' '),
      ['-----BEGIN', 'PRIVATE KEY-----'].join(' '),
    ])
      expect(secretProblems(`key = "${text}"`), text).toHaveLength(1);
  });

  it('lets short test values and ordinary words through', () => {
    for (const text of ['sk-e2e-secret-4242', 'sk-ant-test', 'disk-encryption-guidance-for-every-laptop-and-phone', 'AKIA'])
      expect(secretProblems(text), text).toEqual([]);
  });
});

describe('workflows', () => {
  it('needs every action pinned to a full commit SHA and every image to a digest', () => {
    const bad = [
      'steps:',
      '  - uses: actions/checkout@v6',
      `  - uses: actions/setup-node@${sha.slice(0, 7)}`,
      '    container:',
      '      image: mcr.microsoft.com/playwright:v1.63.0-noble',
      '    container: node:22',
    ].join('\n');
    expect(workflowProblems(bad)).toHaveLength(4);
    const good = [
      `  - uses: actions/checkout@${sha} # v6.1.0`,
      '  - uses: ./.github/actions/local',
      `      image: mcr.microsoft.com/playwright:v1.63.0-noble@sha256:${'b'.repeat(64)}`,
    ].join('\n');
    expect(workflowProblems(good)).toEqual([]);
  });

  it('checks workflow files only', () => {
    expect(textProblems('.github/workflows/ci.yml', 'uses: a/b@v1')).toHaveLength(1);
    expect(textProblems('docs/notes.md', 'uses: a/b@v1')).toEqual([]);
  });
});

describe('commits', () => {
  const commit = { sha, authorEmail: noreply, committerEmail: `noreply${at}github.com`, message: 'WP1: fast checks' };

  it('passes noreply addresses and a clean message', () => {
    expect(commitProblems(commit)).toEqual([]);
  });

  it('refuses any other author or committer address, and a user’s folder or address in the message', () => {
    expect(commitProblems({ ...commit, authorEmail: madeUpAddress })).toHaveLength(1);
    expect(commitProblems({ ...commit, committerEmail: madeUpAddress })).toHaveLength(1);
    expect(commitProblems({ ...commit, message: `Fix the path C:\\${USERS}\\someone\\x` })).toHaveLength(1);
    expect(commitProblems({ ...commit, message: `Thanks ${madeUpAddress}` })).toHaveLength(1);
  });

  it('knows GitHub’s noreply forms', () => {
    expect(isNoreply(noreply)).toBe(true);
    expect(isNoreply(`made-up-name${at}users.noreply.github.com`)).toBe(true);
    expect(isNoreply(`noreply${at}github.com`)).toBe(true);
    expect(isNoreply(`someone${at}users.noreply.github.com.evil.io`)).toBe(false);
    expect(isNoreply(madeUpAddress)).toBe(false);
  });
});

describe('new runtime dependencies', () => {
  const pkg = (dependencies: object, devDependencies: object = {}) => JSON.stringify({ dependencies, devDependencies });

  it('finds names added to dependencies, and nothing else', () => {
    expect(addedDependencies(pkg({ react: '^19' }), pkg({ react: '^19', 'left-pad': '1.0.0' }))).toEqual(['left-pad']);
    expect(addedDependencies(pkg({ react: '^19' }), pkg({ react: '^20' }))).toEqual([]);
    expect(addedDependencies(pkg({ react: '^19' }), pkg({ react: '^19' }, { vitest: '5' }))).toEqual([]);
    expect(addedDependencies(pkg({ react: '^19', old: '1' }), pkg({ react: '^19' }))).toEqual([]);
    expect(addedDependencies(JSON.stringify({}), pkg({ react: '^19' }))).toEqual(['react']);
  });
});

describe('speed', () => {
  it('reads a long run of letters in one pass', () => {
    const started = performance.now();
    expect(personalProblems('a'.repeat(3_000_000))).toEqual([]);
    expect(secretProblems('a'.repeat(3_000_000))).toEqual([]);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
