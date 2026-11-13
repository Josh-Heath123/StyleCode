/**
 * `npm run eval:score [-- <model folder>]`: scores every recorded run in
 * `eval/runs/` against its consultation's answer key, and writes the unclear
 * matches beside each run (`<consultation>.matches.csv`) for a person to
 * settle. Answers already written there are kept and used.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  formatScore,
  inventedRate,
  percent,
  precision,
  readSettled,
  recall,
  scoreRun,
  unclearCsv,
  type KindScore,
  type Score,
} from './scorer.ts';
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
    // A run on an engine's transcript (Phase 3) names the transcript and the translated key it goes with.
    const transcript = JSON.parse(
      readFileSync(run.transcriptFile ? join(DIR, run.transcriptFile) : join(dir, 'transcript.json'), 'utf8'),
    ) as EvalTranscript;
    const key = JSON.parse(
      readFileSync(run.keyFile ? join(DIR, run.keyFile) : join(dir, 'answer-key.json'), 'utf8'),
    ) as AnswerKey;
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
else console.log(summary());

/** How long the meeting ran, in minutes: from its last timestamp, or, for an export without times, from its words. */
function meetingMinutes(transcript: EvalTranscript): { minutes: number; estimated: boolean } {
  const last = transcript.segments.at(-1);
  const end = last?.endMs ?? last?.startMs;
  if (end != null) return { minutes: end / 60_000, estimated: false };
  return { minutes: words(transcript) / wordsPerMinute(), estimated: true };
}
function words(transcript: EvalTranscript): number {
  return transcript.segments.reduce((n, s) => n + s.text.split(/\s+/).filter(Boolean).length, 0);
}
/** The speaking rate of the consultations that have times, used for those that don't. */
function wordsPerMinute(): number {
  let w = 0;
  let ms = 0;
  for (const { run } of totals) {
    const t = transcriptOf(run.consultation);
    const last = t.segments.at(-1);
    const end = last?.endMs ?? last?.startMs;
    if (end == null) continue;
    w += words(t);
    ms += end;
  }
  return ms ? w / (ms / 60_000) : 150;
}
function transcriptOf(id: string): EvalTranscript {
  return JSON.parse(readFileSync(join(DIR, 'consultations', id, 'transcript.json'), 'utf8')) as EvalTranscript;
}

/** One line per run folder, over all its consultations: the scores, and minutes of processing per hour of meeting. */
function summary(): string {
  const rows = new Map<string, { runs: RecordedRun[]; scores: Score[] }>();
  for (const { model, score, run } of totals) {
    const row = rows.get(model) ?? { runs: [], scores: [] };
    row.runs.push(run);
    row.scores.push(score);
    rows.set(model, row);
  }
  const lines = [
    '## Summary\n',
    '| Run | Proposed | Precision | Recall | Invented evidence | Dropped | Unreadable parts | Unsettled | Minutes per hour of meeting |',
    '| --- | --: | --: | --: | --: | --: | --: | --: | --: |',
  ];
  let estimated = false;
  for (const [model, { runs, scores }] of rows) {
    const sum: KindScore = { kind: 'all', proposed: 0, correct: 0, invented: 0, expected: 0, found: 0 };
    for (const s of scores)
      for (const k of ['proposed', 'correct', 'invented', 'expected', 'found'] as const) sum[k] += s.total[k];
    let meeting = 0;
    for (const r of runs) {
      const m = meetingMinutes(transcriptOf(r.consultation));
      meeting += m.minutes;
      estimated ||= m.estimated;
    }
    const processing = runs.reduce((n, r) => n + r.durationMs, 0) / 60_000;
    const perHour = (processing / meeting) * 60;
    lines.push(
      `| ${model} | ${sum.proposed} | ${percent(precision(sum))} | ${percent(recall(sum))} | ${percent(inventedRate(sum))} | ${scores.reduce((n, s) => n + s.dropped, 0)} | ${runs.reduce((n, r) => n + r.unreadableReplies, 0)} | ${scores.reduce((n, s) => n + s.unsettled, 0)} | ${perHour.toFixed(0)} |`,
    );
  }
  if (estimated)
    lines.push(
      `\nA meeting exported without times is timed from its words, at ${wordsPerMinute().toFixed(0)} words a minute (the rate of those with times).`,
    );
  return lines.join('\n');
}
