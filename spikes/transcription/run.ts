/**
 * Runs one candidate on one test meeting and records what it heard, how long
 * it took and what it used (Phase 3 brief, WP2 and decision 8).
 *
 *   node --experimental-strip-types spikes/transcription/run.ts words <candidate> <meeting> <clean|hard> [--names]
 *   node --experimental-strip-types spikes/transcription/run.ts speakers <campplus|eres2net> <meeting> <clean|hard> [--count]
 *
 * Words: whisper-turbo-gpu, whisper-small-gpu, whisper-turbo-cpu, parakeet-cpu.
 * `--names` gives Whisper the session's names as a prompt (decision 9).
 * `--count` tells the speaker engine how many people there were.
 *
 * The audio is `eval/audio/out/<meeting>.<version>.wav` (`npm run eval:audio`).
 * The result goes to `eval/transcription/runs/<run>/<meeting>.<version>.json`.
 * Run one at a time: two runs at once share the CPU and GPU and spoil each
 * other's times. Set STYLECODE_POWER to record how the laptop was powered.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
const count = process.argv.includes('--count');
if (!['words', 'speakers'].includes(kind) || !candidate || !meeting || !['clean', 'hard'].includes(version)) {
  console.error('Usage: run.ts words|speakers <candidate> <meeting> <clean|hard> [--names] [--count]');
  process.exit(1);
}
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
  const run = await runWatched(WHISPER[device], args);
  if (run.code !== 0) throw new Error(`whisper-cli failed (${run.code}).`);
  const words = readWhisperJson(JSON.parse(readFileSync(`${out}.json`, 'utf8')));
  rmSync(`${out}.json`);
  return {
    words,
    stages: [{ name: 'transcribe', wallMs: run.wallMs, resources: run.resources }],
    settings: args.filter((a) => !a.includes(SPIKE_HOME) && a !== wav && !a.startsWith(out)),
  };
}

async function parakeet(): Promise<{ words: EngineWord[]; stages: Stage[]; settings: string[] }> {
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
    writeFileSync(file, writeWav16({ sampleRate: audio.sampleRate, samples: audio.samples.subarray(from, to) }));
    return file;
  });
  const asr = await runWatched(join(SHERPA, 'sherpa-onnx-offline.exe'), [
    `--tokens=${join(PARAKEET, 'tokens.txt')}`,
    `--encoder=${join(PARAKEET, 'encoder.int8.onnx')}`,
    `--decoder=${join(PARAKEET, 'decoder.int8.onnx')}`,
    `--joiner=${join(PARAKEET, 'joiner.int8.onnx')}`,
    '--model-type=nemo_transducer',
    `--num-threads=${THREADS}`,
    ...files,
  ]);
  rmSync(dir, { recursive: true, force: true });
  if (asr.code !== 0) throw new Error(`sherpa-onnx-offline failed (${asr.code}).`);
  const results = readSherpaResults(asr.stdout + '\n' + asr.stderr);
  if (results.length !== pieces.length) throw new Error(`Expected ${pieces.length} results, got ${results.length}.`);
  return {
    words: results.flatMap((r, i) => sherpaWords(r, pieces[i].startMs)),
    stages: [
      { name: 'vad', wallMs: vad.wallMs, resources: vad.resources },
      { name: 'transcribe', wallMs: asr.wallMs, resources: asr.resources },
    ],
    settings: ['silero-vad defaults', `pieces at most 30 s, ${pieces.length} pieces`, `--num-threads=${THREADS}`],
  };
}

async function speakers(model: 'campplus' | 'eres2net'): Promise<{ turns: SpeakerTurn[]; stages: Stage[]; settings: string[] }> {
  const settings = [`--segmentation.num-threads=${THREADS}`, `--embedding.num-threads=${THREADS}`];
  if (count) settings.push(`--clustering.num-clusters=${consultation.participants.length}`);
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

const result =
  kind === 'words'
    ? await (WORDS[candidate] ?? (() => Promise.reject(new Error(`Unknown candidate ${candidate}.`))))()
    : await speakers(candidate as 'campplus' | 'eres2net');
const runId = kind === 'words' ? `${candidate}${names ? '-names' : ''}` : `speakers-${candidate}${count ? '-count' : ''}`;
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
    ? { words: result.words.map((w) => [w.text, w.startMs, w.endMs, w.confidence === null ? null : +w.confidence.toFixed(4)]) }
    : { turns: result.turns.map((t) => [t.label, t.startMs, t.endMs]) }),
};
writeFileSync(join(dir, `${meeting}.${version}.json`), `${JSON.stringify(record)}\n`);
console.log(
  `${runId} ${meeting}.${version}: ${(wallMs / 1000).toFixed(1)} s for ${(audioMs / 60000).toFixed(1)} min (${record.minutesPerHour} min per hour of meeting)`,
);
