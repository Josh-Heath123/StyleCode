/**
 * All of WP3's measurements in order, in one window (Phase 3 brief, decisions
 * 8 to 11). Started by `start-wp3.cmd`. Every driver skips what is already on
 * disk, so starting this again retries only what is missing; a failed step is
 * logged and the rest carry on.
 *
 *   node --experimental-strip-types spikes/transcription/wp3.ts
 *
 * 1. The words and speakers batches (measure.ts).
 * 2. The speaker setup is picked: the lowest share of speech under the wrong
 *    person on the four clean meetings (their mean), fewer labels per person
 *    breaking ties (within 0.1 points).
 * 3. Phase 2's extraction on every words candidate's transcripts, with the
 *    typed ones before and after (decision 8's downstream test).
 * 4. The hour-long meeting at parts of 4096, 6144 and 8192 tokens, and end to
 *    end, with whisper-turbo-gpu (the brief's lead candidate, decision 5);
 *    the other candidates are timed against an extraction run too (decision 10).
 * 5. Live: whisper-turbo-gpu and Parakeet, with Ollama idle and busy (decision 11).
 *
 * Steps 3 and 4 and live's busy runs need Ollama with qwen3:4b. Without it
 * they are logged as skipped, and a later start picks them up.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readRun } from '../../eval/transcription/runs.ts';
import { scoreSpeakers, type TimelineTurnRef } from '../../eval/transcription/score.ts';
import { MEETINGS, MODEL, ROOT, log, step } from './steps.ts';

const RUNS = join(ROOT, 'eval', 'transcription', 'runs');
const WORDS_CANDIDATES = ['whisper-turbo-gpu', 'whisper-turbo-gpu-names', 'whisper-small-gpu', 'parakeet', 'whisper-turbo-cpu'];
const MAIN_WORDS = 'whisper-turbo-gpu';
const OTHER_WORDS = ['parakeet', 'whisper-small-gpu', 'whisper-turbo-cpu'];
const T = 'spikes/transcription/';

interface SpeakerSetup {
  run: string;
  wrong: number;
  labelsPerPerson: number;
}

/** Each complete speakers run (all four clean meetings), scored as decision 8 asks. */
function speakerSetups(): SpeakerSetup[] {
  if (!existsSync(RUNS)) return [];
  return readdirSync(RUNS)
    .filter((d) => /^speakers-(eres2net|campplus)-(count|t[0-9.]+)$/.test(d))
    .flatMap((run) => {
      const scores = MEETINGS.map((m) => {
        const file = join(RUNS, run, `${m}.clean.json`);
        if (!existsSync(file)) return null;
        const r = readRun(JSON.parse(readFileSync(file, 'utf8')));
        const timeline = JSON.parse(readFileSync(join(ROOT, 'eval', 'audio', `${m}.timeline.json`), 'utf8')).clean
          .turns as TimelineTurnRef[];
        return scoreSpeakers(timeline, [], r.turns!, []);
      });
      if (scores.some((s) => s === null)) return [];
      const done = scores as NonNullable<(typeof scores)[number]>[];
      const mean = (f: (s: (typeof done)[number]) => number) => done.reduce((n, s) => n + f(s), 0) / done.length;
      return [{ run, wrong: mean((s) => s.wrongSpeaker), labelsPerPerson: mean((s) => s.labels / s.people) }];
    });
}

function pickSpeakers(): SpeakerSetup | null {
  const setups = speakerSetups().sort((a, b) =>
    Math.abs(a.wrong - b.wrong) < 0.001 ? a.labelsPerPerson - b.labelsPerPerson : a.wrong - b.wrong,
  );
  for (const s of setups)
    log(`speaker setup ${s.run}: ${(s.wrong * 100).toFixed(1)}% wrong person, ${s.labelsPerPerson.toFixed(2)} labels per person`);
  return setups[0] ?? null;
}

/** The run.ts options for a speakers run's name. */
const speakerOptions = (run: string) => {
  const [, model, setting] = run.match(/^speakers-(eres2net|campplus)-(count|t[0-9.]+)$/)!;
  return [model, ...(setting === 'count' ? ['--count'] : ['--threshold', setting.slice(1)])];
};

async function ollamaReady(): Promise<boolean> {
  try {
    const res = await fetch('http://localhost:11434/api/tags');
    const tags = (await res.json()) as { models?: { name: string }[] };
    if (tags.models?.some((m) => m.name === MODEL)) return true;
    log(`Ollama is running but doesn't have ${MODEL}`);
  } catch {
    log('Ollama is not running');
  }
  return false;
}

log(`wp3: started (pid ${process.pid}, power: ${process.env.STYLECODE_POWER ?? 'not recorded'})`);
log(`wp3: downstream words runs ${WORDS_CANDIDATES.join(', ')}; end to end with ${MAIN_WORDS}, also ${OTHER_WORDS.join(', ')}`);

await step('wp3 words and speakers batches', `${T}measure.ts`, ['words', 'speakers']);

const picked = pickSpeakers();
if (picked) log(`wp3: speaker setup picked: ${picked.run}`);
else log('wp3: no complete speakers run, so no speaker setup; the steps that need one are skipped');

if (picked && (await ollamaReady()))
  await step('wp3 extraction downstream', `${T}extraction.ts`, ['downstream', picked.run, ...WORDS_CANDIDATES]);
else log('wp3: skipped extraction downstream');

if (picked && (await ollamaReady())) await step('wp3 extraction sizes', `${T}extraction.ts`, ['sizes', MAIN_WORDS, picked.run]);
else log('wp3: skipped extraction sizes');

if (picked && (await ollamaReady()))
  await step('wp3 end to end', `${T}endtoend.ts`, [MAIN_WORDS, ...speakerOptions(picked.run), ...OTHER_WORDS]);
else log('wp3: skipped end to end');

for (const engine of ['whisper-turbo-gpu', 'parakeet']) {
  await step(`wp3 live ${engine} idle`, `${T}live.ts`, [engine]);
  if (await ollamaReady()) await step(`wp3 live ${engine} busy`, `${T}live.ts`, [engine, '--busy']);
  else log(`wp3: skipped live ${engine} busy`);
}

log('wp3: finished');
