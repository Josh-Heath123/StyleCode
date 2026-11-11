/**
 * Reading whisper.cpp's full JSON output (`whisper-cli -ojf`) as words with
 * times and confidence (Phase 3 brief, "Clarifications"). Pure.
 *
 * Whisper writes tokens, not words: a token that starts with a space begins
 * a new word, and the rest (word pieces, punctuation) belong to the word
 * before. Its own markers (`[_BEG_]`, `[_TT_…]`) are left out. A word's
 * confidence is the lowest probability of its tokens.
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

/** The words of a whisper.cpp `-ojf` file, in time order. Throws if it isn't one. */
export function readWhisperJson(json: unknown): EngineWord[] {
  const doc = json as WhisperJson;
  if (!doc || !Array.isArray(doc.transcription)) throw new Error('This isn’t whisper.cpp’s JSON output.');
  const words: EngineWord[] = [];
  for (const segment of doc.transcription) {
    const tokens = (segment.tokens ?? []).filter((t) => !isMarker(t.text));
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
    for (const t of tokens) {
      const last = words.at(-1);
      const startsWord = /^\s/.test(t.text) || !last || last.endMs < segment.offsets.from;
      if (startsWord) words.push({ text: t.text.trim(), startMs: t.offsets.from, endMs: t.offsets.to, confidence: t.p });
      else {
        last!.text += t.text;
        last!.endMs = Math.max(last!.endMs, t.offsets.to);
        last!.confidence = Math.min(last!.confidence ?? 1, t.p);
      }
    }
  }
  return words.filter((w) => w.text);
}
