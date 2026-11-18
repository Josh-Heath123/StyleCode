/**
 * `npm run notices` (repository brief, R19) writes THIRD-PARTY-NOTICES.md: the third-party parts of StyleCode and
 * their licences. These are the runtime dependencies in package-lock.json, with each licence text from the installed
 * package, and what `npm run transcription:setup` downloads, from its manifest (server/transcription/install.ts).
 * `npm run notices:check` fails if the file is out of date; CI runs it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PINNED } from '../server/transcription/install.ts';

const FILE = 'THIRD-PARTY-NOTICES.md';

interface LockedPackage {
  version: string;
  license?: string;
  dev?: boolean;
}

function runtimePackages(): { name: string; version: string; licence: string; text: string; home: string }[] {
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as { packages: Record<string, LockedPackage> };
  return Object.entries(lock.packages)
    .filter(([path, p]) => path.startsWith('node_modules/') && !p.dev)
    .map(([path, p]) => {
      const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
      const pkg = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8')) as {
        homepage?: string;
        repository?: string | { url?: string };
      };
      const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
      const home = pkg.homepage ?? repo?.replace(/^git\+/, '').replace(/\.git$/, '') ?? `https://www.npmjs.com/package/${name}`;
      const licenceFile = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'license']
        .map((f) => join(path, f))
        .find((f) => {
          try {
            readFileSync(f);
            return true;
          } catch {
            return false;
          }
        });
      if (!licenceFile) throw new Error(`${name} has no licence file.`);
      const text = readFileSync(licenceFile, 'utf8').replace(/\r\n/g, '\n').trim();
      return { name, version: p.version, licence: p.license ?? 'see its licence', text, home };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function notices(): string {
  const lines = [
    '# Third-party notices',
    '',
    '<!-- Written by `npm run notices` from package-lock.json and server/transcription/install.ts. Don’t edit by hand; CI checks it’s up to date. -->',
    '',
    'StyleCode is Copyright © 2026 Joshua Heath (see `COPYRIGHT.md`). The parts below belong to others and keep their own licences.',
    '',
    '## Part of StyleCode',
    '',
    'These runtime dependencies are built into the app. Development tools (`devDependencies`) are used to build and test StyleCode, and aren’t part of what it runs.',
    '',
  ];
  for (const p of runtimePackages()) {
    lines.push(`### ${p.name} ${p.version}`, '', `Licence: ${p.licence}. ${p.home}`, '', '```text', p.text, '```', '');
  }
  lines.push(
    '## Downloaded by `npm run transcription:setup`',
    '',
    'StyleCode doesn’t include these. The setup downloads each one only when the consultant runs it, checks its SHA-256, and writes its licence beside it in `~/.stylecode/transcription/`.',
    '',
  );
  for (const f of PINNED) {
    lines.push(`### ${f.name}`, '', `- Version: ${f.version}`, `- Licence: ${f.licence}`, `- From: ${f.url}`, '');
  }
  return lines.join('\n');
}

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');
  } catch {
    // Missing: out of date.
  }
  if (current !== notices()) {
    console.error(`${FILE} is out of date. Run \`npm run notices\` and commit the result.`);
    process.exit(1);
  }
  console.log(`${FILE} is up to date.`);
} else {
  writeFileSync(FILE, notices());
  console.log(`Wrote ${FILE}.`);
}
