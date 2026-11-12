/**
 * Runs a batch of WP3's measurements one after another (Phase 3 brief,
 * decisions 8 and 9), never two at once, and carries on when one fails: the
 * failure is logged with its reason and the rest still run.
 *
 *   node --experimental-strip-types spikes/transcription/measure.ts words|speakers
 *
 * The log goes to `~/.stylecode/transcription/spike/measure.log`. It holds only
 * the runs' names, times and errors, never what an engine heard.
 */
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { SPIKE_HOME } from './files.ts';

const MEETINGS = ['karoo-freight-kickoff', 'umoya-school-portal', 'veldt-vets-booking', 'bosveld-citrus-intake'];
const VERSIONS = ['clean', 'hard'];
const LOG = join(SPIKE_HOME, 'measure.log');
const RUN = join(import.meta.dirname, 'run.ts');

const batches: Record<string, string[][]> = {
  words: [
    ['whisper-turbo-gpu'],
    ['whisper-turbo-gpu', '--names'],
    ['whisper-small-gpu'],
    ['parakeet'],
    ['whisper-turbo-cpu'],
  ].flatMap((c) => MEETINGS.flatMap((m) => VERSIONS.map((v) => ['words', c[0], m, v, ...c.slice(1)]))),
  speakers: ['eres2net', 'campplus'].flatMap((model) =>
    [['--count'], ['--threshold', '0.5'], ['--threshold', '0.7'], ['--threshold', '0.9']].flatMap((opt) =>
      MEETINGS.flatMap((m) => VERSIONS.map((v) => ['speakers', model, m, v, ...opt])),
    ),
  ),
};

const which = process.argv[2];
const batch = batches[which];
if (!batch) {
  console.error(`Usage: measure.ts ${Object.keys(batches).join('|')}`);
  process.exit(1);
}
mkdirSync(SPIKE_HOME, { recursive: true });
const log = (line: string) => {
  const stamped = `${new Date().toISOString()} ${line}`;
  console.log(stamped);
  appendFileSync(LOG, `${stamped}\n`);
};

log(`batch ${which}: ${batch.length} runs, power: ${process.env.STYLECODE_POWER ?? 'not recorded'}`);
let failed = 0;
for (const args of batch) {
  const { code, out } = await new Promise<{ code: number; out: string }>((done) => {
    const child = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', RUN, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (out += d.toString()));
    child.on('close', (c) => done({ code: c ?? -1, out }));
    child.on('error', (e) => done({ code: -1, out: e.message }));
  });
  if (code === 0) log(`ok ${out.trim().split('\n').at(-1)}`);
  else {
    failed++;
    // The runner prints errors and timings only; keep the last lines, which hold the reason.
    log(`FAILED ${args.join(' ')} (exit ${code}): ${out.trim().split('\n').slice(-3).join(' | ')}`);
  }
}
log(`batch ${which} done: ${batch.length - failed} ok, ${failed} failed`);
