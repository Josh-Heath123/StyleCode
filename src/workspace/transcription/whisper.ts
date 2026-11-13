/**
 * Reading whisper.cpp's full JSON output (`whisper-cli -ojf`) as words with
 * times and confidence (Phase 3 brief, "Clarifications"). Pure.
 *
 * Whisper writes tokens, not words: a token that starts with a space begins
 * a new word, and the rest (word pieces, punctuation) belong to the word
 * before. Its own markers (`[_BEG_]`, `[_TT_…]`) are left out. A word's
 * confidence is the lowest probability of its tokens. Its notes on sounds
 * ("[no audio]", "(music)") aren't speech, so they are left out too.
 *
 * A segment's first token always starts a word. whisper.cpp (v1.9.5) can
 * move a segment's token starts up to the segment's start while leaving
 * their ends earlier, so times can't be used to tell; a word never ends
 * before it starts.
 *
 * With `--vad`, whisper.cpp (v1.9.5) maps each segment's times back to the
 * whole audio but leaves its tokens' times on the clock of the speech alone,
 * with the pauses taken out. So `{ vad: true }` places each segment's tokens
 * across the segment's own times, keeping their spacing.
 */
import type { EngineWord } from './combine';

interface WhisperToken {
  text: string;
  offsets: { from: number; to: number };
  p: number;
}

interface WhisperJson {
  transcription: { offsets: { from: number; to: number }; text: string; tokens?: WhisperToken[] }[];
}

const isMarker = (text: string) => /^\[_[A-Z_0-9]+\]$/.test(text) || /^<\|.*\|>$/.test(text);
/** Whisper's notes on sounds, not speech: "[no audio]", "[BLANK_AUDIO]", "(music)". */
const isAnnotation = (text: string) => /^\s*(?:(?:\[[^\]]*\]|\([^)]*\))\s*)+$/.test(text);

/** The words of a whisper.cpp `-ojf` file, in time order. Throws if it isn't one. */
export function readWhisperJson(json: unknown, options: { vad?: boolean } = {}): EngineWord[] {
  const doc = json as WhisperJson;
  if (!doc || !Array.isArray(doc.transcription)) throw new Error('This isn’t whisper.cpp’s JSON output.');
  const words: EngineWord[] = [];
  for (const segment of doc.transcription) {
    if (isAnnotation(segment.text)) continue;
    let tokens = (segment.tokens ?? []).filter((t) => !isMarker(t.text));
    if (options.vad && tokens.length) {
      const from = Math.min(...tokens.map((t) => t.offsets.from));
      const to = Math.max(...tokens.map((t) => t.offsets.to));
      const scale = to > from ? (segment.offsets.to - segment.offsets.from) / (to - from) : 0;
      const place = (ms: number) => Math.round(segment.offsets.from + (ms - from) * scale);
      tokens = tokens.map((t) => ({ ...t, offsets: { from: place(t.offsets.from), to: place(t.offsets.to) } }));
    }
    if (!tokens.length) {
      // Without tokens (plain -oj), the segment's words share its times evenly.
      const parts = segment.text.trim().split(/\s+/).filter(Boolean);
      const span = (segment.offsets.to - segment.offsets.from) / Math.max(1, parts.length);
      parts.forEach((text, i) =>
        words.push({
          text,
          startMs: Math.round(segment.offsets.from + i * span),
          endMs: Math.round(segment.offsets.from + (i + 1) * span),
          confidence: null,
        }),
      );
      continue;
    }
    tokens.forEach((t, i) => {
      const last = words.at(-1);
      // A segment's first token always starts a word, by position: its times can't tell (see the note at the top).
      if (i === 0 || /^\s/.test(t.text) || !last) {
        words.push({
          text: t.text.trim(),
          startMs: t.offsets.from,
          endMs: Math.max(t.offsets.from, t.offsets.to),
          confidence: t.p,
        });
      } else {
        last.text += t.text;
        last.endMs = Math.max(last.endMs, t.offsets.to);
        last.confidence = Math.min(last.confidence ?? 1, t.p);
      }
    });
  }
  return words.filter((w) => w.text && !isAnnotation(w.text));
}
