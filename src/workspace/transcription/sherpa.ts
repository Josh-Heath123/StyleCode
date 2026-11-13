/**
 * Reading what sherpa-onnx's programs print (Phase 3 brief, "Clarifications").
 * Pure.
 *
 * - `sherpa-onnx-vad`: one line per stretch of speech, "1.062 -- 18.092".
 * - `sherpa-onnx-offline` with a NeMo transducer (Parakeet): one JSON line
 *   per file given, in order, with the tokens, their start times and their
 *   log-probabilities.
 * - `sherpa-onnx-offline-speaker-diarization`: one line per speaker turn,
 *   "1.027 -- 2.039 speaker_00".
 */
import type { EngineWord, SpeakerTurn } from './combine';

const ms = (seconds: string) => Math.round(Number(seconds) * 1000);

/** The stretches of speech the VAD found, in milliseconds. */
export function readVadSegments(stdout: string): { startMs: number; endMs: number }[] {
  return [...stdout.matchAll(/^\s*(\d+(?:\.\d+)?) -- (\d+(?:\.\d+)?)\s*$/gm)].map((m) => ({
    startMs: ms(m[1]),
    endMs: ms(m[2]),
  }));
}

/** The speaker turns the diarization found. */
export function readDiarization(stdout: string): SpeakerTurn[] {
  return [...stdout.matchAll(/^\s*(\d+(?:\.\d+)?) -- (\d+(?:\.\d+)?) (\S+)\s*$/gm)].map((m) => ({
    label: m[3],
    startMs: ms(m[1]),
    endMs: ms(m[2]),
  }));
}

interface SherpaResult {
  text: string;
  tokens: string[];
  timestamps: number[];
  durations?: number[];
  ys_log_probs?: number[];
}

/** The JSON results of `sherpa-onnx-offline`, one per file, in the order the files were given. */
export function readSherpaResults(output: string): SherpaResult[] {
  return output
    .split(/\r?\n/)
    .filter((line) => line.startsWith('{') && line.includes('"tokens"'))
    .map((line) => JSON.parse(line) as SherpaResult);
}

/**
 * A result's words, with times from the start of the whole audio (`offsetMs`
 * is where its piece began). A token starting with a space begins a word; a
 * word's confidence is the lowest probability of its tokens.
 */
export function sherpaWords(result: SherpaResult, offsetMs: number): EngineWord[] {
  const words: EngineWord[] = [];
  result.tokens.forEach((token, i) => {
    const start = offsetMs + Math.round(result.timestamps[i] * 1000);
    const end = start + Math.round((result.durations?.[i] ?? 0.08) * 1000);
    const p = result.ys_log_probs ? Math.exp(result.ys_log_probs[i]) : null;
    const last = words.at(-1);
    if (/^\s/.test(token) || !last) words.push({ text: token.trim(), startMs: start, endMs: end, confidence: p });
    else {
      last.text += token;
      last.endMs = Math.max(last.endMs, end);
      if (p !== null) last.confidence = Math.min(last.confidence ?? 1, p);
    }
  });
  return words.filter((w) => w.text);
}

/**
 * Where to cut long audio into pieces an offline model can take: the VAD's
 * stretches of speech, each widened by a little silence on both sides (but
 * never past the middle of the gap to the next), and long ones split evenly to at most `longestMs`.
 */
export function piecesFrom(
  speech: readonly { startMs: number; endMs: number }[],
  durationMs: number,
  padMs = 200,
  longestMs = 30_000,
): { startMs: number; endMs: number }[] {
  const pieces: { startMs: number; endMs: number }[] = [];
  speech.forEach((s, i) => {
    // Never past the middle of the gap to the next stretch, so no audio is in two pieces.
    const before = i ? Math.round((speech[i - 1].endMs + s.startMs) / 2) : 0;
    const after = i + 1 < speech.length ? Math.round((s.endMs + speech[i + 1].startMs) / 2) : durationMs;
    const start = Math.max(before, s.startMs - padMs, 0);
    const end = Math.min(after, s.endMs + padMs, durationMs);
    const parts = Math.ceil((end - start) / longestMs);
    for (let k = 0; k < parts; k++)
      pieces.push({
        startMs: Math.round(start + ((end - start) * k) / parts),
        endMs: Math.round(start + ((end - start) * (k + 1)) / parts),
      });
  });
  return pieces;
}
