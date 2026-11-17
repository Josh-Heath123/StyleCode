/**
 * `npm run transcription:setup` (Phase 3 brief, decision 7): installs the
 * transcription setup WP3 chose into `~/.stylecode/transcription/`, outside
 * the repository and the data folder. Each download is pinned by version and
 * SHA-256, unpacked with the system's `tar` (which reads zip too), deleted
 * once unpacked, and its licence is written beside it. Stops if the drive
 * would have under 5 GB free.
 *
 * A model the transcription test (WP2) already fetched into `spike/`, with
 * the same SHA-256, is linked rather than downloaded again.
 *
 * StyleCode itself never downloads anything; this is the one step that does,
 * and only when the consultant runs it.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statfsSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { PINNED, transcriptionHome, type PinnedFile } from '../server/transcription/install.ts';

if (process.platform !== 'win32') {
  console.error(
    'Transcription runs on Windows for now: StyleCode uses whisper.cpp’s Windows build with CUDA. Nothing was installed.',
  );
  process.exit(1);
}

const HOME = transcriptionHome();
// Windows has bsdtar, which reads zip and .tar.bz2; Git for Windows puts its own tar first on the path, which reads "C:" as a remote host.
const TAR = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
const GB = 1024 ** 3;
const downloads = join(HOME, 'downloads');
mkdirSync(downloads, { recursive: true });

const freeBytes = () => {
  const s = statfsSync(HOME);
  return s.bavail * s.bsize;
};

async function sha256Of(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/** A single-file model WP2 already fetched, with the same hash. */
async function fromSpike(f: PinnedFile): Promise<string | null> {
  if (f.unpack) return null;
  const candidate = join(HOME, 'spike', f.installed);
  if (!existsSync(candidate)) return null;
  return (await sha256Of(candidate)) === f.sha256 ? candidate : null;
}

const pending = PINNED.filter((f) => !existsSync(join(HOME, f.installed)));
const needed = pending.reduce((n, f) => n + f.bytes * (f.unpack ? 2.5 : 1), 0);
console.log(`${(freeBytes() / GB).toFixed(1)} GB free; ${pending.length} to install, at most ${(needed / GB).toFixed(1)} GB.`);
if (freeBytes() - needed < 5 * GB) {
  console.error('That would leave under 5 GB free, so setup stops. Free some space first.');
  process.exit(1);
}

for (const f of PINNED) {
  const target = join(HOME, f.installed);
  if (existsSync(target)) {
    console.log(`${f.name}: already installed`);
    continue;
  }
  const licence = (sha256: string) =>
    writeFileSync(
      join(f.unpack ? target : dirname(target), `${f.id}.LICENCE.txt`),
      [f.name, f.url, `Version: ${f.version}`, `SHA-256 ${sha256}`, `Licence: ${f.licence}`, ''].join('\n'),
    );

  const spike = await fromSpike(f);
  if (spike) {
    mkdirSync(dirname(target), { recursive: true });
    try {
      linkSync(spike, target);
    } catch {
      copyFileSync(spike, target);
    }
    licence(f.sha256);
    console.log(`${f.name}: installed from the transcription test’s copy`);
    continue;
  }

  const file = join(downloads, f.url.split('/').pop()!.split('?')[0]);
  const hash = createHash('sha256');
  if (existsSync(file)) {
    // Downloaded on an earlier run that stopped before unpacking: checked again, not fetched again.
    for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  } else {
    console.log(`Downloading ${f.name} (${(f.bytes / 1024 ** 2).toFixed(0)} MB)…`);
    const res = await fetch(f.url);
    if (!res.ok || !res.body) throw new Error(`${f.url}: ${res.status}`);
    const part = `${file}.part`;
    const hashing = async function* (chunks: AsyncIterable<Buffer>) {
      for await (const chunk of chunks) {
        hash.update(chunk);
        yield chunk;
      }
    };
    await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), hashing, createWriteStream(part));
    renameSync(part, file);
  }
  const sha256 = hash.digest('hex');
  if (sha256 !== f.sha256) {
    rmSync(file);
    throw new Error(`${f.name}: SHA-256 is ${sha256}, expected ${f.sha256}. Nothing was installed.`);
  }
  const folder = join(HOME, f.unpack ? f.installed : dirname(f.installed));
  mkdirSync(folder, { recursive: true });
  if (f.unpack) {
    const into = f.unpack === 'into-folder' ? folder : HOME;
    const unpacked = spawnSync(TAR, ['-xf', file, '-C', into], { stdio: 'inherit' });
    if (unpacked.status !== 0 || !existsSync(target) || readdirSync(target).length === 0) {
      if (f.unpack === 'into-folder') rmSync(folder, { recursive: true, force: true });
      throw new Error(`Couldn't unpack ${file} to ${target}.`);
    }
    rmSync(file);
  } else renameSync(file, target);
  licence(sha256);
  console.log(`${f.name}: installed (${(freeBytes() / GB).toFixed(1)} GB free)`);
}
console.log(`Transcription is set up in ${HOME}. Open StyleCode's Settings to check it.`);
