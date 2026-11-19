import { describe, expect, it } from 'vitest';
import {
  addedDependencies,
  commitProblems,
  fileProblems,
  isBinary,
  isNoreply,
  mediaOrArchive,
  pathProblems,
  personalProblems,
  secretProblems,
  SIZE_LIMIT,
  textProblems,
  workflowProblems,
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
const bytes = (...parts: (string | number[])[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...Buffer.from(p, 'latin1')] : p)));

describe('files', () => {
  it('refuses audio, video, archives and .env files by name, at any depth and in any case', () => {
    for (const path of [
      'take.wav',
      'docs/a.MP3',
      'clip.mp4',
      'phone.3gp',
      'memo.amr',
      'voice.m4b',
      'old/backup.zip',
      'x.tar.gz',
      'models.7z',
      'pack.whl',
      'setup.msi',
      'a/.env',
      '.env.local',
      '.ENV',
      '.Env.local',
      '.env-local',
      '.env_prod',
      'prod.env',
      '.envrc',
    ])
      expect(pathProblems(path, 10), path).not.toEqual([]);
    for (const path of ['docs/media/demo.gif', 'src/app.ts', '.env.example', 'environment.ts', 'a.envelope', 'x.d.ts'])
      expect(pathProblems(path, 10), path).toEqual([]);
  });

  it('knows audio, video and archives by their first bytes, whatever their name', () => {
    expect(mediaOrArchive('take.dat', bytes('RIFF', [0, 0, 0, 0], 'WAVEfmt '))).toMatch(/audio/);
    expect(mediaOrArchive('song.bin', bytes('ID3', [3, 0]))).toMatch(/audio/);
    expect(mediaOrArchive('x.bin', bytes('fLaC'))).toMatch(/audio/);
    expect(mediaOrArchive('x.bin', bytes([0, 0, 0, 24], 'ftypisom'))).toMatch(/MP4/);
    expect(mediaOrArchive('x.bin', bytes([0x1a, 0x45, 0xdf, 0xa3]))).toMatch(/Matroska/);
    expect(mediaOrArchive('x.bin', bytes('PK', [3, 4]))).toMatch(/zip/);
    expect(mediaOrArchive('x.bin', bytes([0x1f, 0x8b, 8]))).toMatch(/gzip/);
    expect(fileProblems('notes.txt', bytes('RIFF', [0, 0, 0, 0], 'WAVE'))).toEqual([expect.stringContaining('never committed')]);
    // Office documents are zips inside, and HEIF images use MP4's box: neither is refused.
    expect(mediaOrArchive('sample.docx', bytes('PK', [3, 4]))).toBeNull();
    expect(mediaOrArchive('photo.avif', bytes([0, 0, 0, 24], 'ftypavif'))).toBeNull();
    expect(mediaOrArchive('a.gif', bytes('GIF89a'))).toBeNull();
  });

  it('refuses a file over the size limit', () => {
    expect(pathProblems('docs/big.png', SIZE_LIMIT + 1)).toEqual([expect.stringContaining('over the limit')]);
    expect(pathProblems('docs/big.png', SIZE_LIMIT)).toEqual([]);
  });

  it('tells binary files from text', () => {
    expect(isBinary(new Uint8Array([71, 73, 70, 0, 1]))).toBe(true);
    expect(isBinary(new TextEncoder().encode('plain text'))).toBe(false);
  });

  it('still reads a binary file: text after a NUL byte, UTF-16, or inside an image', () => {
    const hidden = `key ${fakeKey('sk-', 48)} at C:\\${USERS}\\someone\\x mail ${madeUpAddress}`;
    for (const content of [
      bytes([0], hidden),
      new Uint8Array(Buffer.from(`\ufeff${hidden}`, 'utf16le')),
      bytes([0x89], 'PNG', [13, 10, 26, 10, 0, 0, 0, 0], 'tEXt', `Comment${String.fromCharCode(0)}${hidden}`),
    ]) {
      const problems = fileProblems('image.png', content);
      expect(problems.some((p) => p.includes('API key'))).toBe(true);
      expect(problems.some((p) => p.includes('user’s folder'))).toBe(true);
      expect(problems.some((p) => p.includes('email address'))).toBe(true);
    }
  });
});

describe('user folders and email addresses', () => {
  it('finds a user’s folder on Windows, macOS, Linux, Git Bash and WSL, written any way, in any case', () => {
    for (const text of [
      `C:\\${USERS}\\someone\\StyleCode`,
      `'D:\\\\${USERS}\\\\someone\\\\x'`,
      `c:/${USERS}/someone/file`,
      `C:\\${USERS.toLowerCase()}\\someone`,
      `C:\\${USERS.toUpperCase()}\\someone`,
      `at /${USERS}/someone/Desktop`,
      `/${USERS.toLowerCase()}/someone`,
      `"/${HOME}/someone/.ssh"`,
      `/c/${USERS}/someone/x`,
      `/mnt/c/${USERS}/someone`,
      `PATH=/x:/${HOME}/someone/bin`,
      `file:///${HOME}/someone/x`,
    ])
      expect(personalProblems(text), text).toEqual([expect.stringContaining('user’s folder')]);
  });

  it('lets placeholders and other paths through', () => {
    for (const text of [
      `C:\\${USERS}\\<you>\\StyleCode Data`,
      `\`/${USERS}/…\``,
      `https://site.example/${HOME}/page`,
      '~/StyleCode Data',
      `src/${HOME}/page.ts`,
    ])
      expect(personalProblems(text), text).toEqual([]);
  });

  it('finds email addresses, written any way, but not GitHub’s noreply ones', () => {
    for (const text of [
      `write to ${madeUpAddress}`,
      `Co-authored-by: Someone <someone${at}company.io>`,
      `bob${'%40'}corp.com`,
      `bob${at}exämple.com`,
    ])
      expect(personalProblems(text), text).toEqual([expect.stringContaining('email address')]);
    for (const ok of [noreply, `noreply${at}github.com`, 'react@19.3.1', '@types/node', 'registry.npmjs.org/%40types%2fnode'])
      expect(personalProblems(ok), ok).toEqual([]);
  });

  it('lets addresses at domains reserved for examples through, but not lookalikes', () => {
    for (const ok of [
      `placeholder="you${at}example.com"`,
      `sam${at}example.net and sam${at}example.org.`,
      `sam${at}mail.example.com`,
      `sam${'%40'}example.com`,
      `SAM${at}EXAMPLE.COM`,
      `sam${at}shop.example`,
      `sam${at}host.test`,
      `sam${at}nowhere.invalid`,
      `sam${at}app.localhost`,
    ]) {
      expect(personalProblems(ok), ok).toEqual([]);
      expect(fileProblems('image.png', bytes([0], ok)), ok).toEqual([]);
    }
    for (const lookalike of [
      `sam${at}example.com.evil.net`,
      `sam${at}myexample.com`,
      `sam${at}example.co`,
      `sam${at}example.community`,
      `sam${at}example.com-evil.net`,
      `sam${at}example.com_evil.net`,
      `sam${at}test.com`,
      `sam${at}example.testing`,
      `sam${at}localhost.co.za`,
      `sam${at}example.invalid.evil.net`,
    ]) {
      expect(personalProblems(lookalike), lookalike).toEqual([expect.stringContaining('email address')]);
      expect(fileProblems('image.png', bytes([0], lookalike)), lookalike).toEqual([expect.stringContaining('email address')]);
    }
  });

  it('reads every %40 in an address, so one that holds two is never taken for an example or a noreply address', () => {
    for (const text of [
      `jo${'%40'}mailhost.co.za${'%40'}example.com`,
      `jo${'%40'}example.com${'%40'}mailhost.co.za`,
      `jo${at}mailhost.co.za${'%40'}example.com`,
      `jo${'%40'}mailhost.co.za${'%40'}users.noreply.github.com`,
      `jo${'%40'}MAILHOST.CO.ZA${'%40'}EXAMPLE.COM`,
    ]) {
      expect(personalProblems(text), text).toEqual([expect.stringContaining('email address')]);
      expect(fileProblems('image.png', bytes([0], text)), text).toEqual([expect.stringContaining('email address')]);
    }
    expect(isNoreply(`jo${'%40'}mailhost.co.za${'%40'}users.noreply.github.com`)).toBe(false);
    expect(personalProblems(`jo${'%40'}x.co.za${'%40'}mailhost.co.za`)[0]).toContain('…@mailhost.co.za');
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
      fakeKey('gho_', 36),
      fakeKey('ghs_', 36),
      fakeKey('github_pat_', 82),
      fakeKey('AKIA', 16, 'ABCDEFGHIJKLMNOP234567'),
      fakeKey('ASIA', 16, 'ABCDEFGHIJKLMNOP234567'),
      `x${fakeKey('AKIA', 16, 'ABCDEFGHIJKLMNOP234567')}`,
      ['-----BEGIN', 'OPENSSH PRIVATE KEY-----'].join(' '),
      ['-----BEGIN', 'PRIVATE KEY-----'].join(' '),
      ['PuTTY-User-Key-File', '3: ssh-ed25519'].join('-'),
    ])
      expect(secretProblems(`key = "${text}"`), text).toHaveLength(1);
  });

  it('lets short test values and ordinary words through', () => {
    for (const text of ['sk-e2e-secret-4242', 'sk-ant-test', 'disk-encryption-guidance-for-every-laptop-and-phone', 'AKIA'])
      expect(secretProblems(text), text).toEqual([]);
  });
});

describe('workflows', () => {
  it('needs every action pinned to a full commit SHA and every image to a digest, in any YAML form', () => {
    for (const line of [
      '  - uses: actions/checkout@v6',
      `  - uses: actions/setup-node@${sha.slice(0, 7)}`,
      'steps: [{uses: actions/checkout@v4}]',
      '  - {uses: actions/checkout@v4, with: {fetch-depth: 0}}',
      '  - "uses": "actions/checkout@v4"',
      "  - 'uses': actions/checkout@v4",
      '  - uses : actions/checkout@v4',
      '      image: mcr.microsoft.com/playwright:v1.63.0-noble',
      '    container: node:22',
      '    container: ${{ env.IMG }}',
      '      image: ${{ matrix.img }}',
      '      - run: docker run --rm node:22 node -v',
    ])
      expect(workflowProblems(line), line).toHaveLength(1);
    const good = [
      `  - uses: actions/checkout@${sha} # v6.1.0`,
      '  - uses: ./.github/actions/local',
      `      image: mcr.microsoft.com/playwright:v1.63.0-noble@sha256:${'b'.repeat(64)}`,
      '    container:',
      '    # uses: anything in a comment',
      `      - run: docker run --rm node@sha256:${'c'.repeat(64)} node -v`,
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

  it('refuses any other author or committer address, and a user’s folder, address or secret in the message', () => {
    expect(commitProblems({ ...commit, authorEmail: madeUpAddress })).toHaveLength(1);
    expect(commitProblems({ ...commit, committerEmail: madeUpAddress })).toHaveLength(1);
    expect(commitProblems({ ...commit, message: `Fix the path C:\\${USERS}\\someone\\x` })).toHaveLength(1);
    expect(commitProblems({ ...commit, message: `Fix /c/${USERS.toLowerCase()}/someone` })).toHaveLength(1);
    expect(commitProblems({ ...commit, message: `Thanks ${madeUpAddress}` })).toHaveLength(1);
    expect(commitProblems({ ...commit, message: `Oops ${fakeKey('ghp_', 36)}` })).toHaveLength(1);
  });

  it('knows GitHub’s noreply forms', () => {
    expect(isNoreply(noreply)).toBe(true);
    expect(isNoreply(`made-up-name${at}users.noreply.github.com`)).toBe(true);
    expect(isNoreply(`noreply${at}github.com`)).toBe(true);
    expect(isNoreply(`someone${at}users.noreply.github.com.evil.io`)).toBe(false);
    expect(isNoreply(madeUpAddress)).toBe(false);
  });

  it('knows an app bot’s noreply form, such as Dependabot’s, and nothing like it', () => {
    expect(isNoreply(`12345+made-up-app[bot]${at}users.noreply.github.com`)).toBe(true);
    expect(isNoreply(`12345+made-up-app[bot]${'%40'}users.noreply.github.com`)).toBe(true);
    for (const lookalike of [
      `made-up-app[bot]${at}users.noreply.github.com`,
      `12345+made-up-app[bot]${at}users.noreply.github.com.evil.io`,
      `12345+made-up-app[bot]${at}noreply.github.com`,
      `12345+made-up-app[robot]${at}users.noreply.github.com`,
      `12345+made-up-app[bot]x${at}users.noreply.github.com`,
      `12345+made up[bot]${at}users.noreply.github.com`,
      `12345+made.up[bot]${at}users.noreply.github.com`,
      `12345+[bot]${at}users.noreply.github.com`,
      `x+made-up-app[bot]${at}users.noreply.github.com`,
      `12345+made-up-app[bot]${at}users.noreply.github.com\n`,
    ])
      expect(isNoreply(lookalike), lookalike).toBe(false);
  });

  it('passes a Dependabot commit: its bot author, GitHub as committer, and its sign-off', () => {
    const bot = `49699333+dependabot[bot]${at}users.noreply.github.com`;
    const message = [
      'Bump made-up-package from 1.0.0 to 1.0.1',
      '',
      '---',
      'updated-dependencies:',
      '- dependency-name: made-up-package',
      '...',
      '',
      `Signed-off-by: dependabot[bot] <support${at}github.com>`,
    ].join('\n');
    expect(commitProblems({ sha, authorEmail: bot, committerEmail: `noreply${at}github.com`, message })).toEqual([]);
    expect(commitProblems({ sha, authorEmail: bot, committerEmail: bot, message })).toEqual([]);
  });

  it('allows GitHub’s support address only on Dependabot’s exact sign-off line', () => {
    const support = `support${at}github.com`;
    for (const message of [
      `Write to ${support}`,
      `Signed-off-by: Someone <${support}>`,
      `Signed-off-by: dependabot <${support}>`,
      `Signed-off-by: dependabot[bot] <${support}> and more`,
      `  Signed-off-by: dependabot[bot] <${support}>`,
      `Signed-off-by: dependabot[bot] <support${at}github.com.evil.io>`,
      `Signed-off-by: dependabot[bot] <help${at}github.com>`,
      `Signed-off-by: dependabot[bot] <${madeUpAddress}>`,
    ])
      expect(commitProblems({ ...commit, message }), message).toEqual([expect.stringContaining('email address')]);
    expect(personalProblems(`Signed-off-by: dependabot[bot] <${support}>`)).toHaveLength(1);
  });
});

describe('new runtime dependencies', () => {
  const pkg = (dependencies: object, more: object = {}) => JSON.stringify({ dependencies, ...more });

  it('finds names added to what npm installs at run time, and nothing else', () => {
    expect(addedDependencies(pkg({ react: '^19' }), pkg({ react: '^19', 'left-pad': '1.0.0' }))).toEqual(['left-pad']);
    expect(addedDependencies(pkg({ react: '^19' }), pkg({ react: '^20' }))).toEqual([]);
    expect(addedDependencies(pkg({ react: '^19' }), pkg({ react: '^19' }, { devDependencies: { vitest: '5' } }))).toEqual([]);
    expect(addedDependencies(pkg({ react: '^19', old: '1' }), pkg({ react: '^19' }))).toEqual([]);
    expect(addedDependencies(JSON.stringify({}), pkg({ react: '^19' }))).toEqual(['react']);
    expect(addedDependencies(pkg({}), pkg({}, { optionalDependencies: { fsevents: '2' } }))).toEqual(['fsevents']);
    expect(addedDependencies(pkg({}), pkg({}, { peerDependencies: { vue: '3' } }))).toEqual(['vue']);
  });

  it('counts an existing name whose package now comes from somewhere other than the registry', () => {
    for (const spec of [
      'npm:evil-pkg@1.0.0',
      'github:evil/react',
      'git+https://host.invalid/r.git',
      'file:../react',
      'https://x.invalid/r.tgz',
    ])
      expect(addedDependencies(pkg({ react: '^19' }), pkg({ react: spec })), spec).toEqual([`react (now from ${spec})`]);
  });
});

describe('speed', () => {
  it('reads a long run of letters in one pass', () => {
    const started = performance.now();
    expect(personalProblems('a'.repeat(3_000_000))).toEqual([]);
    expect(secretProblems('a'.repeat(3_000_000))).toEqual([]);
    expect(fileProblems('big.bin', new Uint8Array(3_000_000))).toEqual([]);
    expect(performance.now() - started).toBeLessThan(3000);
  });
});
