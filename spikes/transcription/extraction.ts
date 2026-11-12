/**
 * WP3's extraction session (Phase 3 brief, decision 8), in one sitting so the
 * GPU's heat is alike for every run:
 *
 *   node --experimental-strip-types spikes/transcription/extraction.ts downstream <speakers run> <words run>...
 *     The typed transcripts of the three short meetings, then each words run's
 *     transcripts of them (clean and hard, with the speakers run's labels
 *     matched to people), then the typed ones again, to show the drift
 *     between runs.
 *
 *   node --experimental-strip-types spikes/transcription/extraction.ts sizes <words run> <speakers run>
 *     The hour-long meeting at parts of 4096, 6144 and 8192 tokens, typed and
 *     as the engine heard it (Phase 2's question 2).
 *
 * Every run is recorded under eval/runs/p3-…/ and scored by `npm run eval:score`.
 */
import { HOUR_MEETING, SHORT_MEETINGS, extractionArgs, log, step } from './steps.ts';

const [plan, ...rest] = process.argv.slice(2);
const folder = (words: string, speakers: string, version: string) =>
  `eval/transcription/extraction/${words}+${speakers}.${version}`;

if (plan === 'downstream') {
  const [speakers, ...wordsRuns] = rest;
  if (!speakers || !wordsRuns.length) throw new Error('downstream <speakers run> <words run>...');
  log(`extraction downstream: ${speakers} with ${wordsRuns.join(', ')}`);
  for (const m of SHORT_MEETINGS) await step(`typed ${m}`, 'eval/run.ts', extractionArgs('p3-typed-6144', 6144, ['--only', m]));
  for (const words of wordsRuns)
    for (const version of ['clean', 'hard']) {
      const built = await step(`transcripts ${words}+${speakers}.${version}`, 'eval/transcription/build.ts', [
        words,
        speakers,
        version,
      ]);
      if (built.code !== 0) continue;
      for (const m of SHORT_MEETINGS)
        await step(
          `extraction ${words}+${speakers}.${version} ${m}`,
          'eval/run.ts',
          extractionArgs(`p3-${words}+${speakers}.${version}`, 6144, [
            '--only',
            m,
            '--transcripts',
            folder(words, speakers, version),
          ]),
        );
    }
  for (const m of SHORT_MEETINGS)
    await step(`typed again ${m}`, 'eval/run.ts', extractionArgs('p3-typed-6144-again', 6144, ['--only', m]));
} else if (plan === 'sizes') {
  const [words, speakers] = rest;
  if (!words || !speakers) throw new Error('sizes <words run> <speakers run>');
  log(`extraction sizes: ${HOUR_MEETING}, typed and ${words}+${speakers}`);
  const built = await step(`transcripts ${words}+${speakers}.clean`, 'eval/transcription/build.ts', [words, speakers, 'clean']);
  for (const context of [4096, 6144, 8192]) {
    await step(
      `typed ${HOUR_MEETING} at ${context}`,
      'eval/run.ts',
      extractionArgs(`p3-typed-${context}`, context, ['--only', HOUR_MEETING]),
    );
    if (built.code === 0)
      await step(
        `${words}+${speakers}.clean ${HOUR_MEETING} at ${context}`,
        'eval/run.ts',
        extractionArgs(`p3-${words}+${speakers}.clean-${context}`, context, [
          '--only',
          HOUR_MEETING,
          '--transcripts',
          folder(words, speakers, 'clean'),
        ]),
      );
  }
} else throw new Error('Plan: downstream or sizes.');
log(`extraction ${plan} done`);
