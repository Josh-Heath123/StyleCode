/**
 * Putting an engine's words and the speaker turns together (Phase 3 brief,
 * decisions 19 and 20). Pure, shared by the local server and the tests.
 *
 * - Each word is given the speaker whose turn it falls in, by time.
 * - A segment ends where the speaker changes, at the end of a sentence once
 *   it is 15 seconds long, or at 30 seconds, so a quoted passage stays short.
 * - Words are marked, not segments (WP3's check-in changed decision 19;
 *   `docs/research/TRANSCRIPTION.md`, "Decided at the check-in"): a segment
 *   keeps the mean of its words' confidence, and the character ranges of its
 *   words below `UNSURE_BELOW`, shown as "may be misheard".
 * - The labels are "Speaker 1", "Speaker 2"…, in the order they first speak.
 */

/** A word as an engine heard it. Times are from the start of the audio. */
export interface EngineWord {
  text: string;
  startMs: number;
  endMs: number;
  /** From 0 to 1, or null when the engine gives none. */
  confidence: number | null;
}

/** A stretch of audio the speaker engine gave to one voice. */
export interface SpeakerTurn {
  label: string;
  startMs: number;
  endMs: number;
}

export interface TranscribedSegment {
  speakerLabel: string | null;
  startMs: number;
  endMs: number;
  text: string;
  /** The mean of its words' confidence, or null when the engine gives none. */
  confidence: number | null;
  /** `[start, end)` in `text` of each word below `UNSURE_BELOW`, without the punctuation around it. */
  unsureWords: [number, number][];
}

/**
 * Words below this are marked "may be misheard". With `--max-context 0` it
 * marks 7.8% of words and catches 49% of the wrong ones (TRANSCRIPTION.md,
 * "After the follow-up measurements").
 */
export const UNSURE_BELOW = 0.8;
export const SENTENCE_SPLIT_MS = 15_000;
export const LONGEST_SEGMENT_MS = 30_000;

/**
 * The speaker of a stretch of time: the turn that overlaps it most, or, if
 * none does, the nearest turn within two seconds (a word just before or
 * after the speaker engine's edges). Null when there's no turn near.
 */
export function speakerAt(turns: readonly SpeakerTurn[], startMs: number, endMs: number): string | null {
  let best: string | null = null;
  let bestOverlap = 0;
  let nearest: string | null = null;
  let nearestGap = 2000;
  for (const t of turns) {
    const overlap = Math.min(endMs, t.endMs) - Math.max(startMs, t.startMs);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = t.label;
    }
    const gap = overlap > 0 ? 0 : Math.max(t.startMs - endMs, startMs - t.endMs);
    if (gap < nearestGap) {
      nearestGap = gap;
      nearest = t.label;
    }
  }
  return best ?? nearest;
}

/** Renames the engine's labels "Speaker 1", "Speaker 2"… in the order they first speak. */
export function speakerNames(labelsInOrder: readonly (string | null)[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const l of labelsInOrder) if (l !== null && !names.has(l)) names.set(l, `Speaker ${names.size + 1}`);
  return names;
}

const endsSentence = (word: string) => /[.!?]["')\]]*$/.test(word);
/** Punctuation that sits against the word before it. */
const tight = (word: string) => /^[,.!?;:]/.test(word);
const LETTER = /[\p{L}\p{N}]/u;

/** The letters and digits of a word, without the punctuation around them, as `[start, end)` within it. */
function core(word: string): [number, number] | null {
  const start = word.search(LETTER);
  if (start < 0) return null;
  let end = word.length;
  while (end > start && !LETTER.test(word[end - 1])) end--;
  return [start, end];
}

type Open = Omit<TranscribedSegment, 'confidence'> & { sum: number; scored: number };

/** The words joined into segments by speaker, following the rules above. Words must be in time order. */
export function segmentsFrom(words: readonly EngineWord[], turns: readonly SpeakerTurn[] | null): TranscribedSegment[] {
  const labelled = words
    .filter((w) => w.text.trim())
    .map((w) => ({ ...w, label: turns ? speakerAt(turns, w.startMs, w.endMs) : null }));
  const names = speakerNames(labelled.map((w) => w.label));
  const segments: TranscribedSegment[] = [];
  let current: Open | null = null;
  const close = () => {
    if (current) {
      const { sum, scored, ...segment } = current;
      segments.push({ ...segment, confidence: scored ? sum / scored : null });
    }
    current = null;
  };
  for (const w of labelled) {
    const speaker = w.label === null ? null : names.get(w.label)!;
    if (current && (current.speakerLabel !== speaker || w.endMs - current.startMs > LONGEST_SEGMENT_MS)) close();
    if (!current)
      current = { speakerLabel: speaker, startMs: w.startMs, endMs: w.endMs, text: '', unsureWords: [], sum: 0, scored: 0 };
    const text = w.text.trim();
    const spaced = current.text !== '' && !tight(text);
    const at = current.text.length + (spaced ? 1 : 0);
    current.text = spaced ? `${current.text} ${text}` : current.text + text;
    current.endMs = Math.max(current.endMs, w.endMs);
    if (w.confidence !== null) {
      current.sum += w.confidence;
      current.scored += 1;
      const letters = core(text);
      if (w.confidence < UNSURE_BELOW && letters) current.unsureWords.push([at + letters[0], at + letters[1]]);
    }
    if (endsSentence(text) && current.endMs - current.startMs >= SENTENCE_SPLIT_MS) close();
  }
  close();
  return segments;
}
