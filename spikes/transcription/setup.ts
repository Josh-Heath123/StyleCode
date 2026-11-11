/**
 * The transcription test's setup (Phase 3 brief, WP2 and decision 7): fetches
 * every candidate of decisions 5 and 6 into `~/.stylecode/transcription/spike/`,
 * outside the repository and the data folder. Each download is pinned by
 * version and SHA-256, unpacked with the system's `tar` (which reads zip too),
 * deleted once unpacked, and its licence is written beside it. Stops if the
 * drive would have under 5 GB free.
 *
 * Run: node --experimental-strip-types spikes/transcription/setup.ts
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statfsSync,
  writeFileSync,
} from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { CANDIDATE_FILES, SPIKE_HOME } from './files.ts';

// Windows has bsdtar, which reads zip and .tar.bz2; Git for Windows puts its own tar first on the path, which reads "C:" as a remote host.
const TAR = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';

const downloads = join(SPIKE_HOME, 'downloads');
mkdirSync(downloads, { recursive: true });

const freeBytes = () => {
  const s = statfsSync(SPIKE_HOME);
  return s.bavail * s.bsize;
};
const GB = 1024 ** 3;
const pending = CANDIDATE_FILES.filter((f) => !existsSync(join(SPIKE_HOME, f.installed)));
const needed = pending.reduce((n, f) => n + f.bytes * (f.unpack ? 2.5 : 1), 0);
console.log(`${(freeBytes() / GB).toFixed(1)} GB free; ${pending.length} to install, about ${(needed / GB).toFixed(1)} GB.`);
if (freeBytes() - needed < 5 * GB) {
  console.error('That would leave under 5 GB free, so setup stops. Free some space first.');
  process.exit(1);
}

for (const f of CANDIDATE_FILES) {
  const target = join(SPIKE_HOME, f.installed);
  if (existsSync(target)) {
    console.log(`${f.name}: already installed`);
    continue;
  }
  const file = join(downloads, f.url.split('/').pop()!.split('?')[0]);
  const hash = createHash('sha256');
  const hashing = async function* (chunks: AsyncIterable<Buffer>) {
    for await (const chunk of chunks) {
      hash.update(chunk);
      yield chunk;
    }
  };
  if (existsSync(file)) {
    // Downloaded on an earlier run that stopped before unpacking: checked again, not fetched again.
    for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  } else {
    console.log(`Downloading ${f.name} (${(f.bytes / 1024 ** 2).toFixed(0)} MB)…`);
    const res = await fetch(f.url);
    if (!res.ok || !res.body) throw new Error(`${f.url}: ${res.status}`);
    const part = `${file}.part`;
    await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), hashing, createWriteStream(part));
    renameSync(part, file);
  }
  const sha256 = hash.digest('hex');
  // A file without a published hash is pinned on its first download (--pin), and its hash then goes in files.ts.
  if (!f.sha256 && process.argv.includes('--pin')) console.log(`  ${f.id}: SHA-256 ${sha256} (put it in files.ts)`);
  else if (sha256 !== f.sha256) {
    rmSync(file);
    throw new Error(`${f.name}: SHA-256 is ${sha256}, expected ${f.sha256}. Nothing was installed.`);
  }
  const folder = join(SPIKE_HOME, f.unpack ? f.installed : join(f.installed, '..'));
  mkdirSync(folder, { recursive: true });
  if (f.unpack) {
    const into = f.unpack === 'into-folder' ? folder : SPIKE_HOME;
    const unpacked = spawnSync(TAR, ['-xf', file, '-C', into], { stdio: 'inherit' });
    if (unpacked.status !== 0 || !existsSync(target) || readdirSync(target).length === 0) {
      if (f.unpack === 'into-folder') rmSync(folder, { recursive: true, force: true });
      throw new Error(`Couldn't unpack ${file} to ${target}.`);
    }
    rmSync(file);
  } else renameSync(file, target);
  writeFileSync(
    join(f.unpack ? target : join(target, '..'), `${f.id}.LICENCE.txt`),
    [f.name, f.url, `Version: ${f.version}`, `SHA-256 ${sha256}`, `Licence: ${f.licence}`, ''].join('\n'),
  );
  console.log(`${f.name}: installed (${(freeBytes() / GB).toFixed(1)} GB free)`);
}
