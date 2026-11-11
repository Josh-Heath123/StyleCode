/**
 * `npm run eval:audio [-- <consultation>…]`: turns each typed meeting into
 * synthetic speech (Phase 3 brief, decisions 2 and 3).
 *
 * Each turn is spoken in its speaker's voice (`voices.json`) by Kokoro, run
 * by sherpa-onnx 1.13.8 (`npm run eval:audio:setup` installs it). A turn's
 * speech is kept in `eval/audio/out/cache/`, so a second run only speaks
 * what changed. Then each meeting is mixed twice, clean and hard, into
 * `eval/audio/out/<id>.clean.wav` and `.hard.wav` (16 kHz mono 16-bit, never
 * in git), with its timeline in `eval/audio/<id>.timeline.json` (in git).
 *
 * The mix fails if the tool reports a skipped word or token, or if a turn
 * comes out too short for its words: the timeline would then hold words the
 * audio doesn't.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EvalTranscript } from '../types.ts';
import { resample } from './dsp.ts';
import { spokenText, tooShort, trimSilence, turnsOf } from './speech.ts';
import { hardRoom, mixTurns, normalise, placeTurns, type MeetingAudio, type Timeline, type Version } from './timeline.ts';
import { KOKORO_VOICES, ttsCommand } from './tools.ts';
import { readWav, writeWav16 } from './wav.ts';

const HERE = import.meta.dirname;
const CONSULTATIONS = join(HERE, '..', 'consultations');
const OUT = join(HERE, 'out');
const CACHE = join(OUT, 'cache');
const RATE = 16000;
/** Several voices at once, each on a few threads: the laptop has 20. */
const PARALLEL = 3;
const THREADS = 6;

interface Voices {
  meetings: Record<string, Record<string, { voice: string; accent: 'us' | 'gb' }>>;
}

const voices = JSON.parse(readFileSync(join(HERE, 'voices.json'), 'utf8')) as Voices;
const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const ids = (wanted.length ? wanted : Object.keys(voices.meetings)).sort();
mkdirSync(CACHE, { recursive: true });

/** Speaks one turn, or takes it from the cache; returns 16 kHz samples, trimmed of the tool's own silence. */
async function speak(text: string, voice: string, accent: 'us' | 'gb'): Promise<Float32Array> {
  const sid = KOKORO_VOICES[voice];
  if (sid === undefined) throw new Error(`Unknown voice ${voice}.`);
  const said = spokenText(text);
  const key = createHash('sha256').update(`kokoro-v1.0/${voice}/${accent}/${said}`).digest('hex').slice(0, 24);
  const file = join(CACHE, `${key}.wav`);
  if (!existsSync(file)) {
    const tmp = `${file}.part.wav`;
    const { program, args } = ttsCommand(said, sid, accent, tmp, THREADS);
    const stderr = await new Promise<string>((done, fail) => {
      const child = spawn(program, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      child.stderr.on('data', (d: Buffer) => (err += d.toString()));
      child.on('error', fail);
      child.on('close', (code) =>
        code === 0 ? done(err) : fail(new Error(`The voice tool failed (${code}) on: ${said}\n${err}`)),
      );
    });
    const skipped = stderr.split('\n').filter((l) => /\boov\b|skipp|out of vocabulary|not in (the )?lexicon/i.test(l));
    if (skipped.length) throw new Error(`The voice tool skipped something in “${said}”:\n${skipped.join('\n')}`);
    renameSync(tmp, file);
  }
  const audio = readWav(new Uint8Array(readFileSync(file)));
  return trimSilence(resample(audio.samples, audio.sampleRate, RATE), RATE);
}

/** Runs the jobs a few at a time. */
async function inParallel<T>(jobs: (() => Promise<T>)[], width: number): Promise<T[]> {
  const results: T[] = new Array(jobs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: width }, async () => {
      while (next < jobs.length) {
        const i = next++;
        results[i] = await jobs[i]();
      }
    }),
  );
  return results;
}

for (const id of ids) {
  const started = Date.now();
  const transcript = JSON.parse(readFileSync(join(CONSULTATIONS, id, 'transcript.json'), 'utf8')) as EvalTranscript;
  const audio = JSON.parse(readFileSync(join(HERE, `${id}.json`), 'utf8')) as MeetingAudio;
  const cast = voices.meetings[id];
  if (!cast) throw new Error(`${id}: no voices in voices.json.`);
  const turns = turnsOf(transcript);
  for (const t of turns) if (!cast[t.speaker]) throw new Error(`${id}: no voice for ${t.speaker}.`);
  const known = new Set(turns.map((t) => t.turn));
  for (const t of [...audio.interjections, ...(audio.pause ? [audio.pause.afterTurn] : [])])
    if (!known.has(t)) throw new Error(`${id}.json names ${t}, which isn't a turn.`);

  let done = 0;
  const spoken = await inParallel(
    turns.map((t) => async () => {
      const samples = await speak(t.text, cast[t.speaker].voice, cast[t.speaker].accent);
      if (++done % 25 === 0) console.log(`${id}: ${done} of ${turns.length} turns spoken`);
      return samples;
    }),
    PARALLEL,
  );
  const short = turns.filter((t, i) => tooShort(t.text, spoken[i].length / RATE));
  if (short.length)
    throw new Error(
      `${id}: these turns came out too short for their words, so words may be missing: ${short.map((t) => t.turn).join(', ')}`,
    );

  const byTurn = new Map(turns.map((t, i) => [t.turn, spoken[i]]));
  const withLength = turns.map((t, i) => ({ ...t, durationMs: Math.round((spoken[i].length / RATE) * 1000) }));
  // The speech's loudness over the turns only, so silence between them doesn't lower it.
  let sum = 0;
  let count = 0;
  for (const s of spoken) for (let i = 0; i < s.length; i++) ((sum += s[i] * s[i]), count++);
  const speechLoudness = Math.sqrt(sum / count);
  const timelines: Partial<Record<Version, Omit<Timeline, 'consultation' | 'version' | 'sampleRate'>>> = {};
  for (const version of ['clean', 'hard'] as const) {
    const placed = placeTurns(id, version, withLength, audio);
    const speech = mixTurns(placed.turns, placed.durationMs, RATE, (t) => byTurn.get(t)!);
    const mixed = normalise(version === 'hard' ? hardRoom(speech, speechLoudness, RATE, id) : speech);
    writeFileSync(join(OUT, `${id}.${version}.wav`), writeWav16({ sampleRate: RATE, samples: mixed }));
    timelines[version] = placed;
  }
  const words = turns.reduce((n, t) => n + t.text.split(/\s+/).filter(Boolean).length, 0);
  writeFileSync(
    join(HERE, `${id}.timeline.json`),
    `${JSON.stringify({ consultation: id, sampleRate: RATE, voices: cast, ...timelines }, null, 2)}\n`,
  );
  const minutes = (ms: number) => (ms / 60000).toFixed(1);
  console.log(
    `${id}: ${turns.length} turns, ${words} words; clean ${minutes(timelines.clean!.durationMs)} min, hard ${minutes(timelines.hard!.durationMs)} min; made in ${((Date.now() - started) / 1000).toFixed(0)} s`,
  );
}
