/**
 * `npm run eval:audio:check`: the voice check of decision 2. Nobody listens to
 * the synthetic voices, so each voice's turns are scored from a transcription
 * of the clean meeting by the best candidate (recorded in
 * `eval/transcription/runs/<run>/`). A voice with more than 30% of its words
 * wrong is replaced, and the swap recorded in `voices.json`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readRun } from '../transcription/runs.ts';
import { errorsBySpeaker, scoreWords, scriptWords } from '../transcription/score.ts';

const HERE = import.meta.dirname;
const run = process.argv[2] ?? 'whisper-turbo-gpu';
const voices = JSON.parse(readFileSync(join(HERE, 'voices.json'), 'utf8')) as {
  meetings: Record<string, Record<string, { voice: string }>>;
};
let failed = 0;
for (const meeting of Object.keys(voices.meetings).sort()) {
  const turns = JSON.parse(readFileSync(join(HERE, `${meeting}.timeline.json`), 'utf8')).clean.turns;
  const record = readRun(
    JSON.parse(readFileSync(join(HERE, '..', 'transcription', 'runs', run, `${meeting}.clean.json`), 'utf8')),
  );
  const { steps } = scoreWords(turns, record.words!);
  const bySpeaker = errorsBySpeaker(steps, scriptWords(turns).speakers);
  for (const [speaker, s] of Object.entries(bySpeaker).sort()) {
    const bad = s.rate > 0.3;
    if (bad) failed++;
    console.log(
      `${meeting}  ${speaker.padEnd(24)} ${voices.meetings[meeting][speaker]?.voice.padEnd(12)} ${(s.rate * 100).toFixed(1).padStart(5)}% of ${s.words} words${bad ? '  REPLACE' : ''}`,
    );
  }
}
console.log(failed ? `${failed} voice(s) over 30%: replace them.` : 'Every voice is under 30% of words wrong.');
process.exitCode = failed ? 1 : 0;
