/**
 * Live transcription, measured and not built (Phase 3 brief, decision 11):
 * the first 20 minutes of the hour-long clean meeting are fed in 30-second
 * pieces at real-time pace,
 * as a recording would hand them over, and each piece is transcribed as soon
 * as it is complete (one at a time; a piece waits if the one before is still
 * running). Each piece's lag is the time from the end of its 30 seconds to
 * its text being ready.
 *
 *   node --experimental-strip-types spikes/transcription/live.ts <whisper-turbo-gpu|parakeet> [--busy]
 *
 * `--busy` keeps an extraction run going the whole time (qwen3:4b at 6144 on
 * the typed meetings, one after another), as when the consultant asks for
 * findings on another meeting during this one.
 *
 * The pieces are cut at fixed 30-second marks, so a word can be split
 * between two; that is part of what is measured. The words are recorded
 * as a run (eval/transcription/runs/live-<engine>-<idle|busy>/) so the
 * report scores them, and the lags go to eval/transcription/live/.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readWav, writeWav16 } from '../../eval/audio/wav.ts';
import type { EngineWord } from '../../src/workspace/transcription/combine.ts';
import { readSherpaResults, sherpaWords } from '../../src/workspace/transcription/sherpa.ts';
import { readWhisperJson } from '../../src/workspace/transcription/whisper.ts';
import { SPIKE_HOME } from './files.ts';
import { hardware, runWatched } from './monitor.ts';
import { HOUR_MEETING, MEETINGS, ROOT, beginDriver, extractionArgs, gpuLog, log, startScript, unloadModel } from './steps.ts';

const PIECE_MS = 30_000;
const THREADS = 8;
const engine = process.argv[2];
const busy = process.argv.includes('--busy');
if (engine !== 'whisper-turbo-gpu' && engine !== 'parakeet') throw new Error('live.ts <whisper-turbo-gpu|parakeet> [--busy]');

const MODELS = join(SPIKE_HOME, 'models');
const WHISPER = join(SPIKE_HOME, 'whisper-cuda', 'Release', 'whisper-cli.exe');
const SHERPA = join(SPIKE_HOME, 'sherpa-onnx-v2.0.1-win-x64-shared-MD-Release', 'bin', 'sherpa-onnx-offline.exe');
const PARAKEET = join(SPIKE_HOME, 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8');
const WORK = join(SPIKE_HOME, 'work', 'live');

const audio = readWav(new Uint8Array(readFileSync(join(ROOT, 'eval', 'audio', 'out', `${HOUR_MEETING}.clean.wav`))));
const perMs = audio.sampleRate / 1000;
// The first 20 minutes, not the hour: long enough for the GPU to slow with
// heat (after about a minute) and, when busy, to span a whole extraction run
// (about 13 minutes), at a third of the laptop's time.
const LIVE_MS = 20 * 60_000;
const audioMs = Math.min(LIVE_MS, Math.round(audio.samples.length / perMs));
const pieces = Array.from({ length: Math.ceil(audioMs / PIECE_MS) }, (_, i) => ({
  startMs: i * PIECE_MS,
  endMs: Math.min((i + 1) * PIECE_MS, audioMs),
}));

/** Transcribes one piece, returning its words on the meeting's clock. */
async function transcribe(file: string, offsetMs: number): Promise<EngineWord[]> {
  if (engine === 'whisper-turbo-gpu') {
    const out = file.replace(/\.wav$/, '');
    const run = await runWatched(WHISPER, [
      '-m',
      join(MODELS, 'ggml-large-v3-turbo-q5_0.bin'),
      '-f',
      file,
      '-l',
      'en',
      '-t',
      String(THREADS),
      '-ojf',
      '-of',
      out,
    ]);
    if (run.code !== 0) throw new Error(`whisper-cli failed (${run.code}).`);
    const words = readWhisperJson(JSON.parse(readFileSync(`${out}.json`, 'utf8')));
    rmSync(`${out}.json`);
    return words.map((w) => ({ ...w, startMs: w.startMs + offsetMs, endMs: w.endMs + offsetMs }));
  }
  const run = await runWatched(SHERPA, [
    `--tokens=${join(PARAKEET, 'tokens.txt')}`,
    `--encoder=${join(PARAKEET, 'encoder.int8.onnx')}`,
    `--decoder=${join(PARAKEET, 'decoder.int8.onnx')}`,
    `--joiner=${join(PARAKEET, 'joiner.int8.onnx')}`,
    '--model-type=nemo_transducer',
    `--num-threads=${THREADS}`,
    file,
  ]);
  if (run.code !== 0) throw new Error(`sherpa-onnx-offline failed (${run.code}).`);
  const [result] = readSherpaResults(run.stdout + '\n' + run.stderr);
  return result ? sherpaWords(result, offsetMs) : [];
}

// An extraction run kept going in the background, for --busy.
let stopBusy = false;
let busyChild: ReturnType<typeof startScript> | null = null;
let busyRuns = 0;
async function keepBusy() {
  const typed = MEETINGS;
  for (let i = 0; !stopBusy; i++) {
    busyChild = startScript(
      'busy extraction',
      'eval/run.ts',
      extractionArgs('p3-live-busy', 6144, ['--only', typed[i % typed.length]]),
    );
    const r = await busyChild.done;
    if (!stopBusy) {
      busyRuns++;
      if (r.code !== 0) log(`FAILED busy extraction: ${r.tail}`);
    }
  }
}

const condition = busy ? 'busy' : 'idle';
const summaryFile = join(ROOT, 'eval', 'transcription', 'live', `${engine}.${condition}.json`);
if (existsSync(summaryFile)) {
  log(`skip live ${engine} ${condition}: done before`);
  process.exit(0);
}
beginDriver(`live ${engine} ${condition}: ${pieces.length} pieces of 30 s`);
mkdirSync(WORK, { recursive: true });
await unloadModel();
const busyLoop = busy ? keepBusy() : null;
if (busy) await new Promise((r) => setTimeout(r, 20_000)); // let extraction load its model first
const gpu = gpuLog();
const t0 = Date.now();
const results: { piece: number; readyAfterMs: number; lagMs: number; wallMs: number; words: number; error?: string }[] = [];
const words: EngineWord[] = [];
let wordDelayTotal = 0;
for (const [i, p] of pieces.entries()) {
  const available = t0 + p.endMs;
  const wait = available - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  const file = join(WORK, `${String(i).padStart(4, '0')}.wav`);
  writeFileSync(
    file,
    writeWav16({
      sampleRate: audio.sampleRate,
      samples: audio.samples.subarray(Math.round(p.startMs * perMs), Math.round(p.endMs * perMs)),
    }),
  );
  const started = Date.now();
  try {
    const got = await transcribe(file, p.startMs);
    const done = Date.now();
    words.push(...got);
    for (const w of got) wordDelayTotal += done - (t0 + w.startMs);
    results.push({ piece: i, readyAfterMs: done - t0, lagMs: done - available, wallMs: done - started, words: got.length });
  } catch (error) {
    results.push({
      piece: i,
      readyAfterMs: Date.now() - t0,
      lagMs: Date.now() - available,
      wallMs: Date.now() - started,
      words: 0,
      error: (error as Error).message,
    });
    log(`live piece ${i} failed: ${(error as Error).message}`);
  }
  rmSync(file, { force: true });
}
const gpuUsed = gpu.stop();
stopBusy = true;
(busyChild as ReturnType<typeof startScript> | null)?.child.kill(); // assigned in keepBusy, which TypeScript can't see
await busyLoop;

const lags = results
  .filter((r) => !r.error)
  .map((r) => r.lagMs)
  .sort((a, b) => a - b);
const at = (q: number) => lags[Math.min(lags.length - 1, Math.floor(q * lags.length))] ?? null;
const summary = {
  engine,
  condition,
  meeting: HOUR_MEETING,
  pieceMs: PIECE_MS,
  audioMs,
  pieces: pieces.length,
  failed: results.filter((r) => r.error).length,
  lagMs: { median: at(0.5), p90: at(0.9), max: lags.at(-1) ?? null },
  /** On average, how long after a word was spoken its text was ready. */
  meanWordDelayMs: words.length ? Math.round(wordDelayTotal / words.length) : null,
  busyExtractionRuns: busy ? busyRuns : undefined,
  at: new Date(t0).toISOString(),
  hardware: hardware(),
  gpu: gpuUsed,
  results,
};
const live = join(ROOT, 'eval', 'transcription', 'live');
mkdirSync(live, { recursive: true });
writeFileSync(join(live, `${engine}.${condition}.json`), `${JSON.stringify(summary, null, 2)}\n`);

const runId = `live-${engine}-${condition}`;
const runDir = join(ROOT, 'eval', 'transcription', 'runs', runId);
mkdirSync(runDir, { recursive: true });
const wallMs = results.reduce((n, r) => n + r.wallMs, 0);
writeFileSync(
  join(runDir, `${HOUR_MEETING}.clean.json`),
  `${JSON.stringify({
    kind: 'words',
    run: runId,
    meeting: HOUR_MEETING,
    version: 'clean',
    audioMs,
    wallMs,
    minutesPerHour: +((wallMs / audioMs) * 60).toFixed(2),
    at: summary.at,
    hardware: summary.hardware,
    settings: [
      'the first 20 minutes, in 30-second pieces at real-time pace',
      `--threads ${THREADS}`,
      ...(busy ? ['extraction running throughout'] : []),
    ],
    stages: [{ name: 'transcribe (sum of pieces)', wallMs, resources: null }],
    words: words.map((w) => [w.text, w.startMs, w.endMs, w.confidence === null ? null : +w.confidence.toFixed(4)]),
  })}\n`,
);
log(
  `live ${engine} ${condition} done: lag median ${summary.lagMs.median} ms, p90 ${summary.lagMs.p90} ms, max ${summary.lagMs.max} ms, ${summary.failed} failed`,
);
