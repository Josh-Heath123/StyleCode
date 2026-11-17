// A fake transcription engine for tests (Phase 3 brief, "Clarifications": no
// engine and no network in tests). It answers like whisper.cpp's whisper-cli
// and sherpa-onnx's offline speaker diarization, with recorded output: the
// words and speaker turns WP3 recorded for Karoo Freight's role-played
// kick-off (eval/transcription/runs), clipped to the length of the audio given.
//
//   node engine.mjs whisper -m <model> -f <wav> ... -ojf -of <out> -pp
//   node engine.mjs speakers --segmentation.pyannote-model=... ... <wav>
//
// FAKE_ENGINE_STEP_MS slows each step down, so a test can cancel a run;
// FAKE_ENGINE_FAIL=whisper or =speakers makes that program fail.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const recorded = JSON.parse(readFileSync(join(here, 'karoo-freight-kickoff.json'), 'utf8'));
const [mode, ...args] = process.argv.slice(2);
const step = Number(process.env.FAKE_ENGINE_STEP_MS ?? 0);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The audio's length, from its WAV header: 16 kHz mono 16-bit. */
function lengthMs(wav) {
  const bytes = readFileSync(wav);
  const rate = bytes.readUInt32LE(24);
  const blockAlign = bytes.readUInt16LE(32);
  return Math.floor(((bytes.length - 44) / blockAlign / rate) * 1000);
}

async function progress(write) {
  for (const p of [0, 25, 50, 75, 100]) {
    write(p);
    if (step) await sleep(step);
  }
}

if (process.env.FAKE_ENGINE_FAIL === mode) {
  process.stderr.write('fake engine: failing as asked\n');
  process.exit(3);
}

if (mode === 'whisper') {
  const wav = args[args.indexOf('-f') + 1];
  const out = args[args.indexOf('-of') + 1];
  const ms = lengthMs(wav);
  await progress((p) => process.stderr.write(`whisper_print_progress_callback: progress = ${String(p).padStart(3)}%\n`));
  // One whisper.cpp segment per sentence, each word a token starting with a space.
  const transcription = [];
  let tokens = [];
  for (const [text, from, to, p] of recorded.words) {
    if (from >= ms) break;
    tokens.push({ text: ` ${text}`, offsets: { from, to }, p });
    if (/[.!?]$/.test(text)) {
      transcription.push(segment(tokens));
      tokens = [];
    }
  }
  if (tokens.length) transcription.push(segment(tokens));
  writeFileSync(`${out}.json`, JSON.stringify({ transcription }));
} else if (mode === 'speakers') {
  const wav = args.at(-1);
  const ms = lengthMs(wav);
  await progress((p) => process.stderr.write(`progress ${p.toFixed(2)}%\n`));
  for (const [label, from, to] of recorded.turns) {
    if (from >= ms) break;
    process.stdout.write(`${(from / 1000).toFixed(3)} -- ${(Math.min(to, ms) / 1000).toFixed(3)} ${label}\n`);
  }
} else {
  process.stderr.write('Usage: engine.mjs whisper|speakers ...\n');
  process.exit(2);
}

function segment(tokens) {
  return {
    offsets: { from: tokens[0].offsets.from, to: tokens.at(-1).offsets.to },
    text: tokens.map((t) => t.text).join(''),
    tokens,
  };
}
