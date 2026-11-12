/**
 * `npm run eval:transcription`: scores every recorded transcription run in
 * `eval/transcription/runs/` against its meeting's timeline, and prints the
 * tables `docs/research/TRANSCRIPTION.md` is written from (Phase 3 brief,
 * decision 8). The results are a lower bound on errors: the speech is
 * synthetic.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scoreSpeakers, scoreWords, type TimelineTurnRef } from './score.ts';
import { readRun, type RunRecord } from './runs.ts';

const HERE = import.meta.dirname;
const RUNS = join(HERE, 'runs');
const TIMELINES = join(HERE, '..', 'audio');

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const timelineCache = new Map<string, TimelineTurnRef[]>();
function timeline(meeting: string, version: string): TimelineTurnRef[] {
  const key = `${meeting}.${version}`;
  if (!timelineCache.has(key)) {
    const t = JSON.parse(readFileSync(join(TIMELINES, `${meeting}.timeline.json`), 'utf8'));
    timelineCache.set(key, t[version].turns);
  }
  return timelineCache.get(key)!;
}

const runs: RunRecord[] = existsSync(RUNS)
  ? readdirSync(RUNS)
      .sort()
      .flatMap((dir) =>
        readdirSync(join(RUNS, dir))
          .filter((f) => f.endsWith('.json'))
          .sort()
          .map((f) => readRun(JSON.parse(readFileSync(join(RUNS, dir, f), 'utf8')))),
      )
  : [];
const wordRuns = runs.filter((r) => r.kind === 'words');
const speakerRuns = runs.filter((r) => r.kind === 'speakers');

console.log('## Words\n');
console.log('| Run | Meeting | Version | Word errors | Raw | Sub / del / ins | Key terms found | Minutes per hour |');
console.log('| --- | --- | --- | --: | --: | --- | --: | --: |');
const scored = new Map<RunRecord, ReturnType<typeof scoreWords>>();
for (const r of wordRuns) {
  const s = scoreWords(timeline(r.meeting, r.version), r.words!);
  scored.set(r, s);
  console.log(
    `| ${r.run} | ${r.meeting} | ${r.version} | ${pct(s.wer)} | ${pct(s.rawWer)} | ${s.sub} / ${s.del} / ${s.ins} | ${s.terms.found} of ${s.terms.occurrences} | ${r.minutesPerHour} |`,
  );
}

console.log('\n## Speakers\n');
console.log(
  '| Run | Meeting | Version | People | Labels | Labels per person | Wrong speaker | Missed | Speech where none | Minutes per hour |',
);
console.log('| --- | --- | --- | --: | --: | --: | --: | --: | --: | --: |');
for (const r of speakerRuns) {
  const t = timeline(r.meeting, r.version);
  const s = scoreSpeakers(t, [], r.turns!, []);
  console.log(
    `| ${r.run} | ${r.meeting} | ${r.version} | ${s.people} | ${s.labels} | ${(s.labels / s.people).toFixed(2)} | ${pct(s.wrongSpeaker)} | ${pct(s.missed)} | ${pct(s.falseSpeech)} | ${r.minutesPerHour} |`,
  );
}

console.log('\n## Words given the right speaker\n');
console.log('| Words | Speakers | Meeting | Version | Right speaker |');
console.log('| --- | --- | --- | --- | --: |');
for (const w of wordRuns)
  for (const sp of speakerRuns.filter((s) => s.meeting === w.meeting && s.version === w.version)) {
    const s = scoreSpeakers(timeline(w.meeting, w.version), w.words!, sp.turns!, scored.get(w)!.steps);
    console.log(`| ${w.run} | ${sp.run} | ${w.meeting} | ${w.version} | ${pct(s.wordsRightSpeaker)} |`);
  }

console.log('\n## Confidence\n');
console.log('| Run | Meeting | Version | Threshold | Words below | Wrong below | Wrong above | Wrong words caught |');
console.log('| --- | --- | --- | --: | --: | --: | --: | --: |');
for (const r of wordRuns)
  for (const c of scored.get(r)!.confidence ?? [])
    console.log(
      `| ${r.run} | ${r.meeting} | ${r.version} | ${c.threshold} | ${pct(c.below)} | ${pct(c.wrongBelow)} | ${pct(c.wrongAbove)} | ${pct(c.caught)} |`,
    );

console.log('\n## Key terms most often missed\n');
for (const r of wordRuns) {
  const missed = scored.get(r)!.terms.missed.slice(0, 8);
  if (missed.length)
    console.log(
      `- **${r.run}, ${r.meeting}, ${r.version}:** ${missed.map((m) => `${m.term} (${m.times}×: ${m.writtenAs.join(', ')})`).join('; ')}`,
    );
}
