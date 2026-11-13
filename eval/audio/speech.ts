/**
 * From a typed transcript to what the voices say (Phase 3 brief, decision 3).
 * Pure.
 */
import type { EvalTranscript } from '../types.ts';
import type { SpokenTurn } from './timeline.ts';

/** The transcript's turns: consecutive segments by one speaker, with their words joined. */
export function turnsOf(transcript: EvalTranscript): SpokenTurn[] {
  const turns: SpokenTurn[] = [];
  for (const s of transcript.segments) {
    const last = turns.at(-1);
    if (last && last.turn === s.turn) {
      last.segments.push(s.id);
      last.text = `${last.text} ${s.text}`;
    } else turns.push({ turn: s.turn, speaker: s.speakerLabel ?? '(no speaker)', segments: [s.id], text: s.text });
  }
  return turns;
}

/**
 * The words as the voice tool should read them: typographic quotes, dashes and
 * ellipses become plain ones it knows, so none of them is dropped. The
 * timeline keeps the typed text.
 */
export function spokenText(text: string): string {
  return text
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/…/g, '...')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Whether speech this long is too short for these words: faster than about
 * seven words a second, which no voice speaks, means some were skipped.
 * Turns of one or two words ("Mm.") aren't judged.
 */
export function tooShort(text: string, seconds: number): boolean {
  const words = text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  return words >= 3 && seconds < words * 0.14;
}

/** The samples without the silence the tool leaves at either end, keeping 30 ms, so the timeline marks the speech itself. */
export function trimSilence(samples: Float32Array, rate: number, threshold = 0.003): Float32Array {
  let first = 0;
  while (first < samples.length && Math.abs(samples[first]) < threshold) first++;
  let last = samples.length - 1;
  while (last > first && Math.abs(samples[last]) < threshold) last--;
  if (first >= samples.length) return new Float32Array(0);
  const margin = Math.round(0.03 * rate);
  return samples.slice(Math.max(0, first - margin), Math.min(samples.length, last + 1 + margin));
}
