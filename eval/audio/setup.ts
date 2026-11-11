/**
 * `npm run eval:audio:setup`: downloads the tool that speaks the test meetings
 * (sherpa-onnx 1.13.8 and Kokoro v1.0) into `~/.stylecode/transcription/voices/`,
 * checks each file's SHA-256, unpacks it with the system's `tar`, and keeps
 * its licence beside it. Stops if C: (or the home drive) has under 5 GB free.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statfsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { VOICE_TOOLS, VOICES_HOME } from './tools.ts';

// Windows has bsdtar, which reads zip and .tar.bz2; Git for Windows puts its own tar first on the path, which reads "C:" as a remote host.
const TAR = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';

const downloads = join(VOICES_HOME, '..', 'downloads');
mkdirSync(downloads, { recursive: true });

const free = (() => {
  const s = statfsSync(VOICES_HOME.split(/[\\/]/)[0] + '/');
  return s.bavail * s.bsize;
})();
const needed = VOICE_TOOLS.reduce((n, t) => n + t.bytes, 0) * 2.5;
if (free - needed < 5 * 1024 ** 3) {
  console.error(`Only ${(free / 1024 ** 3).toFixed(1)} GB free; setup stops under 5 GB. Free some space first.`);
  process.exit(1);
}

for (const tool of VOICE_TOOLS) {
  const folder = join(VOICES_HOME, tool.folder);
  const licence = () =>
    writeFileSync(
      join(folder, 'STYLECODE-LICENCE.txt'),
      `${tool.name}\n${tool.url}\nSHA-256 ${tool.sha256}\nLicence: ${tool.licence}\n`,
    );
  if (existsSync(folder)) {
    if (!existsSync(join(folder, 'STYLECODE-LICENCE.txt'))) licence();
    console.log(`${tool.name}: already installed`);
    continue;
  }
  const file = join(downloads, tool.url.split('/').pop()!);
  if (!existsSync(file)) {
    console.log(`Downloading ${tool.name} (${(tool.bytes / 1024 ** 2).toFixed(0)} MB)…`);
    const res = await fetch(tool.url);
    if (!res.ok) throw new Error(`${tool.url}: ${res.status}`);
    writeFileSync(file, new Uint8Array(await res.arrayBuffer()));
  }
  const hash = createHash('sha256').update(readFileSync(file)).digest('hex');
  if (hash !== tool.sha256) throw new Error(`${file}: SHA-256 is ${hash}, expected ${tool.sha256}. Delete it and try again.`);
  mkdirSync(VOICES_HOME, { recursive: true });
  const unpacked = spawnSync(TAR, ['-xjf', file, '-C', VOICES_HOME], { stdio: 'inherit' });
  if (unpacked.status !== 0) throw new Error(`Couldn't unpack ${file}.`);
  licence();
  console.log(`${tool.name}: installed`);
}
