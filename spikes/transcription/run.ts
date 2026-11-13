/**
 * Runs one candidate on one test meeting and records what it heard, how long
 * it took and what it used (Phase 3 brief, WP2 and decision 8).
 *
 *   node --experimental-strip-types spikes/transcription/run.ts words <candidate> <meeting> <clean|hard> [--names] [--vad] [--no-context]
 *   node --experimental-strip-types spikes/transcription/run.ts speakers <campplus|eres2net> <meeting> <clean|hard> [--count | --threshold <x>] [--min-on <s>]
 *
 * Words: whisper-turbo-gpu, whisper-small-gpu, whisper-turbo-cpu, parakeet-cpu.
 * `--names` gives Whisper the session's names as a prompt (decision 9).
 * `--no-context` stops Whisper conditioning on its own previous text
 * (`--max-context 0`), which is what repeats a sentence through a pause.
 * `--vad` has whisper.cpp skip what Silero VAD (ggml) finds isn't speech, so it
 * can't write words into a pause.
 * `--min-on <s>` has the speaker engine drop speech shorter than that (its
 * `--min-duration-on`, default 0.3 s), to see whether short fragments make the
 * extra labels.
 * `--count` tells the speaker engine how many people there were; without it,
 * `--threshold <x>` sets its clustering threshold (sherpa-onnx default 0.5;
 * larger gives fewer speakers).
 *
 * The audio is `eval/audio/out/<meeting>.<version>.wav` (`npm run eval:audio`).
 * The result goes to `eval/transcription/runs/<run>/<meeting>.<version>.json`.
 * `--label <name>` records the run under that name instead (WP3's end-to-end and
 * concurrency runs, so they don't replace the batch's records).
 * Run one at a time: two runs at once share the CPU and GPU and spoil each
 * other's times. Set STYLECODE_POWER to record how the laptop was powered.
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { readWav, writeWav16 } from '../../eval/audio/wav.ts';
import type { EngineWord, SpeakerTurn } from '../../src/workspace/transcription/combine.ts';
import {
  piecesFrom,
  readDiarization,
  readSherpaResults,
  readVadSegments,
  sherpaWords,
} from '../../src/workspace/transcription/sherpa.ts';
import { readWhisperJson } from '../../src/workspace/transcription/whisper.ts';
import { SPIKE_HOME } from './files.ts';
import { hardware, runWatched, type Resources } from './monitor.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const AUDIO = join(ROOT, 'eval', 'audio', 'out');
const RUNS = join(ROOT, 'eval', 'transcription', 'runs');
const WORK = join(SPIKE_HOME, 'work');
const THREADS = 8;
/** Pieces per sherpa-onnx-offline call for Parakeet (it decodes all it is given at once). */
const PARAKEET_BATCH = 8;

const WHISPER = {
  gpu: join(SPIKE_HOME, 'whisper-cuda', 'Release', 'whisper-cli.exe'),
  cpu: join(SPIKE_HOME, 'whisper-cpu', 'Release', 'whisper-cli.exe'),
};
const MODELS = join(SPIKE_HOME, 'models');
const SHERPA = join(SPIKE_HOME, 'sherpa-onnx-v2.0.1-win-x64-shared-MD-Release', 'bin');
const PARAKEET = join(SPIKE_HOME, 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8');
const EMBEDDINGS = {
  campplus: join(MODELS, '3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx'),
  eres2net: join(MODELS, '3dspeaker_speech_eres2net_sv_en_voxceleb_16k.onnx'),
};

interface Stage {
  name: string;
  wallMs: number;
  resources: Resources;
}

const [kind, candidate, meeting, version] = process.argv.slice(2);
const names = process.argv.includes('--names');
const vad = process.argv.includes('--vad');
const noContext = process.argv.includes('--no-context');
const minOnAt = process.argv.indexOf('--min-on');
const minOn = minOnAt > 0 ? Number(process.argv[minOnAt + 1]) : null;
if (minOn !== null && !(minOn >= 0 && minOn <= 10)) throw new Error('--min-on takes seconds, from 0 to 10.');
const count = process.argv.includes('--count');
const labelAt = process.argv.indexOf('--label');
const label = labelAt > 0 ? process.argv[labelAt + 1] : null;
if (label !== null && !/^[a-z0-9.+-]+$/i.test(label))
  throw new Error('--label takes a name of letters, digits, dots and dashes.');
const thresholdAt = process.argv.indexOf('--threshold');
const threshold = thresholdAt > 0 ? Number(process.argv[thresholdAt + 1]) : null;
if (threshold !== null && (count || !(threshold > 0 && threshold < 2)))
  throw new Error('--threshold takes a number, without --count.');
if (!['words', 'speakers'].includes(kind) || !candidate || !meeting || !['clean', 'hard'].includes(version)) {
  console.error(
    'Usage: run.ts words|speakers <candidate> <meeting> <clean|hard> [--names] [--vad] [--no-context] [--count | --threshold <x>] [--min-on <s>]',
  );
  process.exit(1);
}
if ((vad || noContext) && !(kind === 'words' && candidate.startsWith('whisper-')))
  throw new Error('--vad and --no-context are for the Whisper words candidates.');
if (minOn !== null && kind !== 'speakers') throw new Error('--min-on is for speakers.');
const wav = join(AUDIO, `${meeting}.${version}.wav`);
const audio = readWav(new Uint8Array(readFileSync(wav)));
const audioMs = Math.round((audio.samples.length / audio.sampleRate) * 1000);
const consultation = JSON.parse(readFileSync(join(ROOT, 'eval', 'consultations', meeting, 'consultation.json'), 'utf8')) as {
  title: string;
  participants: { name: string }[];
};

/** The names hint (decision 9): the session's participants, and the meeting's title (company and engagement). */
const hint = () => `${consultation.title}. ${consultation.participants.map((p) => p.name).join(', ')}.`;

async function whisper(
  device: 'gpu' | 'cpu',
  model: string,
): Promise<{ words: EngineWord[]; stages: Stage[]; settings: string[] }> {
  mkdirSync(WORK, { recursive: true });
  const out = join(WORK, `${meeting}.${version}`);
  const args = ['-m', join(MODELS, model), '-f', wav, '-l', 'en', '-t', String(THREADS), '-ojf', '-of', out];
  if (names) args.push('--prompt', hint());
  if (noContext) args.push('--max-context', '0');
  if (vad) args.push('--vad', '--vad-model', join(MODELS, 'ggml-silero-v6.2.0.bin'));
  const run = await runWatched(WHISPER[device], args);
  if (run.code !== 0) throw new Error(`whisper-cli failed (${run.code}).`);
  const words = readWhisperJson(JSON.parse(readFileSync(`${out}.json`, 'utf8')), { vad });
  rmSync(`${out}.json`);
  return {
    words,
    stages: [{ name: 'transcribe', wallMs: run.wallMs, resources: run.resources }],
    settings: args.filter((a) => !a.includes(SPIKE_HOME) && a !== wav && !a.startsWith(out)),
  };
}

async function parakeet(): Promise<{
  words: EngineWord[];
  stages: Stage[];
  settings: string[];
}> {
  const vad = await runWatched(join(SHERPA, 'sherpa-onnx-vad.exe'), [
    `--silero-vad-model=${join(MODELS, 'silero_vad.onnx')}`,
    wav,
    join(WORK, 'vad.wav'),
  ]);
  if (vad.code !== 0) throw new Error(`sherpa-onnx-vad failed (${vad.code}).`);
  rmSync(join(WORK, 'vad.wav'), { force: true });
  const pieces = piecesFrom(readVadSegments(vad.stdout + vad.stderr), audioMs);
  const dir = join(WORK, `${meeting}.${version}.pieces`);
  mkdirSync(dir, { recursive: true });
  const files = pieces.map((p, i) => {
    const file = join(dir, `${String(i).padStart(4, '0')}.wav`);
    const from = Math.round((p.startMs / 1000) * audio.sampleRate);
    const to = Math.round((p.endMs / 1000) * audio.sampleRate);
    writeFileSync(
      file,
      writeWav16({
        sampleRate: audio.sampleRate,
        samples: audio.samples.subarray(from, to),
      }),
    );
    return basename(file);
  });
  // sherpa-onnx-offline decodes every file it is given in one batch, so its
  // memory grows with the audio (8.7 GB for 7 minutes): call it on a few
  // pieces at a time, the same for every meeting. It runs in the pieces'
  // folder and names them without it, to keep the command line short.
  const calls: { wallMs: number; decodeMs: number | null; resources: Resources }[] = [];
  const results: ReturnType<typeof readSherpaResults> = [];
  for (let at = 0; at < files.length; at += PARAKEET_BATCH) {
    const batch = files.slice(at, at + PARAKEET_BATCH);
    const asr = await runWatched(
      join(SHERPA, 'sherpa-onnx-offline.exe'),
      [
        `--tokens=${join(PARAKEET, 'tokens.txt')}`,
        `--encoder=${join(PARAKEET, 'encoder.int8.onnx')}`,
        `--decoder=${join(PARAKEET, 'decoder.int8.onnx')}`,
        `--joiner=${join(PARAKEET, 'joiner.int8.onnx')}`,
        '--model-type=nemo_transducer',
        `--num-threads=${THREADS}`,
        ...batch,
      ],
      { cwd: dir },
    );
    const output = asr.stdout + '\n' + asr.stderr;
    if (asr.code !== 0) {
      rmSync(dir, { recursive: true, force: true });
      // Only the lines that read as errors: the rest of what it prints holds what it heard.
      const errors = output
        .split(/\r?\n/)
        .filter(
          (l) => !l.trimStart().startsWith('{') && /error|exception|fail|abort|what\(\)|cannot|invalid|out of memory/i.test(l),
        )
        .slice(-3)
        .map((l) => l.trim().slice(0, 200));
      throw new Error(
        `sherpa-onnx-offline failed (exit ${asr.code}, pieces ${at} to ${at + batch.length - 1}): ${errors.join(' / ') || 'no error text'}`,
      );
    }
    const got = readSherpaResults(output);
    if (got.length !== batch.length) throw new Error(`Expected ${batch.length} results from pieces ${at}…, got ${got.length}.`);
    results.push(...got);
    // It times its own decoding, from after the model is loaded; the rest of the call is start-up.
    const elapsed = output.match(/Elapsed seconds:\s*([\d.]+)/);
    calls.push({
      wallMs: asr.wallMs,
      decodeMs: elapsed ? Math.round(Number(elapsed[1]) * 1000) : null,
      resources: asr.resources,
    });
  }
  rmSync(dir, { recursive: true, force: true });
  const sum = (f: (c: (typeof calls)[number]) => number) => calls.reduce((n, c) => n + f(c), 0);
  const timed = calls.every((c) => c.decodeMs !== null);
  const startups = timed ? calls.map((c) => c.wallMs - c.decodeMs!).sort((a, b) => a - b) : [];
  const merged = (): Resources => ({
    peakRamMiB: Math.max(...calls.map((c) => c.resources.peakRamMiB ?? 0)) || null,
    peakGpuMemoryMiB: Math.max(...calls.map((c) => c.resources.peakGpuMemoryMiB ?? 0)) || null,
    gpuMemoryBeforeMiB: calls[0]?.resources.gpuMemoryBeforeMiB ?? null,
    gpu: calls.flatMap((c) => c.resources.gpu),
  });
  return {
    words: results.flatMap((r, i) => sherpaWords(r, pieces[i].startMs)),
    stages: [
      { name: 'vad', wallMs: vad.wallMs, resources: vad.resources },
      // Start-up (loading the model) and decoding apart: the app would load the model once.
      ...(timed
        ? [
            { name: `start-up, ${calls.length} calls`, wallMs: sum((c) => c.wallMs - c.decodeMs!), resources: merged() },
            { name: 'transcribe', wallMs: sum((c) => c.decodeMs!), resources: merged() },
          ]
        : [{ name: `transcribe, ${calls.length} calls with start-up`, wallMs: sum((c) => c.wallMs), resources: merged() }]),
    ],
    settings: [
      'silero-vad defaults',
      `pieces at most 30 s, ${pieces.length} pieces`,
      `${PARAKEET_BATCH} pieces per call, ${calls.length} calls`,
      ...(timed ? [`start-up per call: median ${startups[Math.floor(startups.length / 2)]} ms`] : []),
      `--num-threads=${THREADS}`,
    ],
  };
}

async function speakers(model: 'campplus' | 'eres2net'): Promise<{ turns: SpeakerTurn[]; stages: Stage[]; settings: string[] }> {
  const settings = [`--segmentation.num-threads=${THREADS}`, `--embedding.num-threads=${THREADS}`];
  if (count) settings.push(`--clustering.num-clusters=${consultation.participants.length}`);
  if (threshold !== null) settings.push(`--clustering.cluster-threshold=${threshold}`);
  if (minOn !== null) settings.push(`--min-duration-on=${minOn}`);
  const run = await runWatched(join(SHERPA, 'sherpa-onnx-offline-speaker-diarization.exe'), [
    `--segmentation.pyannote-model=${join(SPIKE_HOME, 'sherpa-onnx-pyannote-segmentation-3-0', 'model.onnx')}`,
    `--embedding.model=${EMBEDDINGS[model]}`,
    ...settings,
    wav,
  ]);
  if (run.code !== 0) throw new Error(`The speaker engine failed (${run.code}).`);
  return {
    turns: readDiarization(run.stdout),
    stages: [{ name: 'speakers', wallMs: run.wallMs, resources: run.resources }],
    settings,
  };
}

const WORDS: Record<string, () => Promise<{ words: EngineWord[]; stages: Stage[]; settings: string[] }>> = {
  'whisper-turbo-gpu': () => whisper('gpu', 'ggml-large-v3-turbo-q5_0.bin'),
  'whisper-small-gpu': () => whisper('gpu', 'ggml-small.bin'),
  'whisper-turbo-cpu': () => whisper('cpu', 'ggml-large-v3-turbo-q5_0.bin'),
  parakeet: parakeet,
};

const result = await (
  kind === 'words'
    ? (WORDS[candidate] ?? (() => Promise.reject(new Error(`Unknown candidate ${candidate}.`))))()
    : speakers(candidate as 'campplus' | 'eres2net')
).catch((error: Error) => {
  // The drivers log the last lines printed, so the reason goes last, after the stack.
  console.error(error.stack);
  console.error(`run.ts failed: ${error.message}`);
  process.exit(1);
});
const runId =
  label ??
  (kind === 'words'
    ? `${candidate}${names ? '-names' : ''}${vad ? '-vad' : ''}${noContext ? '-mc0' : ''}`
    : `speakers-${candidate}${count ? '-count' : threshold !== null ? `-t${threshold}` : ''}${minOn !== null ? `-on${minOn}` : ''}`);
const dir = join(RUNS, runId);
mkdirSync(dir, { recursive: true });
const wallMs = result.stages.reduce((n, s) => n + s.wallMs, 0);
const record = {
  kind,
  run: runId,
  meeting,
  version,
  audioMs,
  wallMs,
  minutesPerHour: +((wallMs / audioMs) * 60).toFixed(2),
  at: new Date().toISOString(),
  hardware: hardware(),
  settings: result.settings,
  stages: result.stages,
  ...('words' in result
    ? {
        words: result.words.map((w) => [w.text, w.startMs, w.endMs, w.confidence === null ? null : +w.confidence.toFixed(4)]),
      }
    : { turns: result.turns.map((t) => [t.label, t.startMs, t.endMs]) }),
};
// Written whole and then renamed, so a stopped run never leaves a part-written
// record that measure.ts would take as done.
const recordFile = join(dir, `${meeting}.${version}.json`);
writeFileSync(`${recordFile}.part`, `${JSON.stringify(record)}\n`);
renameSync(`${recordFile}.part`, recordFile);
console.log(
  `${runId} ${meeting}.${version}: ${(wallMs / 1000).toFixed(1)} s for ${(audioMs / 60000).toFixed(1)} min (${record.minutesPerHour} min per hour of meeting)`,
);
