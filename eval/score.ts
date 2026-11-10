/**
 * `npm run eval:score [-- <model folder>]`: scores every recorded run in
 * `eval/runs/` against its consultation's answer key, and writes the unclear
 * matches beside each run (`<consultation>.matches.csv`) for a person to
 * settle. Answers already written there are kept and used.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatScore, readSettled, scoreRun, unclearCsv, type Score } from './scorer.ts';
import type { AnswerKey, EvalTranscript, RecordedRun } from './types.ts';

const DIR = import.meta.dirname;
const RUNS = join(DIR, 'runs');
const only = process.argv[2];

const totals: { model: string; score: Score; run: RecordedRun }[] = [];
for (const model of readdirSync(RUNS).sort()) {
  if (only && only !== model) continue;
  for (const file of readdirSync(join(RUNS, model))
    .filter((f) => f.endsWith('.json'))
    .sort()) {
    const run = JSON.parse(readFileSync(join(RUNS, model, file), 'utf8')) as RecordedRun;
    const dir = join(DIR, 'consultations', run.consultation);
    const transcript = JSON.parse(readFileSync(join(dir, 'transcript.json'), 'utf8')) as EvalTranscript;
    const key = JSON.parse(readFileSync(join(dir, 'answer-key.json'), 'utf8')) as AnswerKey;
    const csvPath = join(RUNS, model, file.replace(/\.json$/, '.matches.csv'));
    const settled = existsSync(csvPath) ? readSettled(readFileSync(csvPath, 'utf8')) : new Map<string, boolean>();
    const score = scoreRun(transcript, key, run.proposals, settled);
    if (score.unclear.length) writeFileSync(csvPath, unclearCsv(score, key, run.proposals, settled));
    totals.push({ model, score, run });
    console.log(`## ${run.model}: ${run.consultation} (${(run.durationMs / 1000).toFixed(0)} s, ${run.chunks} parts)\n`);
    console.log(formatScore(score));
    console.log();
  }
}
if (!totals.length) console.log('No recorded runs. Make one with npm run eval:run -- --model <name>.');
