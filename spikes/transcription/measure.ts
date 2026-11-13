/**
 * Runs batches of WP3's measurements one after another (Phase 3 brief,
 * decisions 8 and 9), never two at once, and carries on when one fails: the
 * failure is logged with its reason and the rest still run.
 *
 *   node --experimental-strip-types spikes/transcription/measure.ts words|speakers [words|speakers]
 *
 * A run whose result is already in eval/transcription/runs/ is skipped, so a
 * stopped batch is started again with the same command. Progress goes to
 * eval/transcription/progress.log (steps.ts).
 */
import { join } from 'node:path';
import { HOUR_MEETING, MEETINGS, ROOT, beginDriver, log, step } from './steps.ts';

const VERSIONS = ['clean', 'hard'];
const RUNS = join(ROOT, 'eval', 'transcription', 'runs');

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
  // ERes2Net at 0.8, between 0.7 (5.1% wrong, 2.85 labels per person) and 0.9 (15.8%, 1.47): added on 13 November.
  speakers08: MEETINGS.flatMap((m) => VERSIONS.map((v) => ['speakers', 'eres2net', m, v, '--threshold', '0.8'])),
  // Added at the WP3 check-in (13 November): whisper.cpp's own VAD, on every meeting, clean and hard.
  vad: MEETINGS.flatMap((m) => VERSIONS.map((v) => ['words', 'whisper-turbo-gpu', m, v, '--vad'])),
  // And the picked speaker setup dropping speech under 1 s and 2 s (default 0.3 s): the clean meetings and the hard hour.
  fragments: ['1', '2'].flatMap((on) =>
    [...MEETINGS.map((m) => [m, 'clean']), [HOUR_MEETING, 'hard']].map(([m, v]) => [
      'speakers',
      'eres2net',
      m,
      v,
      '--threshold',
      '0.7',
      '--min-on',
      on,
    ]),
  ),
};

/** The run's record, named as run.ts names it. */
function resultOf([kind, candidate, meeting, version, ...opt]: string[]): string {
  const after = (flag: string) => Number(opt[opt.indexOf(flag) + 1]);
  const runId =
    kind === 'words'
      ? `${candidate}${opt.includes('--names') ? '-names' : ''}${opt.includes('--vad') ? '-vad' : ''}`
      : `speakers-${candidate}${opt[0] === '--count' ? '-count' : `-t${after('--threshold')}`}${opt.includes('--min-on') ? `-on${after('--min-on')}` : ''}`;
  return join(RUNS, runId, `${meeting}.${version}.json`);
}

const which = process.argv.slice(2);
if (!which.length || which.some((w) => !batches[w])) {
  console.error(`Usage: measure.ts ${Object.keys(batches).join('|')} [...]`);
  process.exit(1);
}
beginDriver(`measure ${which.join(' ')}`);
for (const name of which) {
  const batch = batches[name];
  log(`batch ${name}: ${batch.length} runs`);
  let failed = 0;
  let skipped = 0;
  for (const args of batch) {
    const r = await step(args.join(' '), 'spikes/transcription/run.ts', args, resultOf(args));
    if (r.skipped) skipped++;
    else if (r.code !== 0) failed++;
  }
  log(`batch ${name} done: ${batch.length - failed - skipped} run, ${skipped} done before, ${failed} failed`);
}
log(`driver measure ${which.join(' ')} done`);
