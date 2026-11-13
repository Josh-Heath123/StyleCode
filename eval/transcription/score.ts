/**
 * Scores one transcription against its meeting's timeline (Phase 3 brief,
 * decision 8): word errors (normalised, and raw), key terms, confidence, and,
 * with a speaker run, speakers and the share of words given the right
 * speaker. Pure: the caller reads the files.
 */
import type { EngineWord, SpeakerTurn } from '../../src/workspace/transcription/combine.ts';
import { speakerAt } from '../../src/workspace/transcription/combine.ts';
import { alignWords, errorRate, type Step } from './align.ts';
import { normaliseTagged, normaliseWords } from './normalise.ts';
import { matchLabels, speakerScores, type RefTurn, type SpeakerScores } from './speakers.ts';
import { namesIn, termScores, type TermScores } from './terms.ts';

export interface TimelineTurnRef extends RefTurn {
  text: string;
}

/** Raw words: lower case and without punctuation, nothing else changed. */
export const rawWords = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\s]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

export interface ConfidenceRow {
  threshold: number;
  /** Share of the engine's words below the threshold. */
  below: number;
  /** Of the words below it, the share that were wrong. */
  wrongBelow: number;
  /** Of the words at or above it, the share that were wrong. */
  wrongAbove: number;
  /** Of all wrong words, the share below the threshold: what a "may be misheard" mark would catch. */
  caught: number;
}

export interface WordScores {
  refWords: number;
  hypWords: number;
  wer: number;
  sub: number;
  del: number;
  ins: number;
  rawWer: number;
  terms: TermScores;
  confidence: ConfidenceRow[] | null;
}

export const THRESHOLDS = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];

/** The script's normalised words, each with the person who said it. */
export function scriptWords(turns: readonly TimelineTurnRef[]): { words: string[]; speakers: string[] } {
  const words: string[] = [];
  const speakers: string[] = [];
  for (const t of turns)
    for (const w of normaliseWords(t.text)) {
      words.push(w);
      speakers.push(t.speaker);
    }
  return { words, speakers };
}

/** The engine's normalised words, each with the index of the engine word it came from, normalised together. */
export function engineWords(words: readonly EngineWord[]): { words: string[]; from: number[] } {
  const tagged = normaliseTagged(words.map((w) => w.text));
  return { words: tagged.map((t) => t.word), from: tagged.map((t) => t.from) };
}

export function scoreWords(turns: readonly TimelineTurnRef[], words: readonly EngineWord[]): WordScores & { steps: Step[] } {
  const ref = scriptWords(turns);
  const hyp = engineWords(words);
  const steps = alignWords(ref.words, hyp.words);
  const rate = errorRate(steps, ref.words.length);
  const rawRef = turns.flatMap((t) => rawWords(t.text));
  const rawHyp = rawWords(words.map((w) => w.text).join(' '));
  const raw = errorRate(alignWords(rawRef, rawHyp), rawRef.length);

  // An engine word is wrong if any normalised word from it was substituted or inserted.
  const wrong = new Uint8Array(words.length);
  for (const s of steps) if (s.op === 'sub' || s.op === 'ins') wrong[hyp.from[s.hyp]] = 1;
  // Words that normalise to nothing (fillers, punctuation) are neither right nor wrong, so they're left out.
  const scored = words.map((w, i) => ({
    confidence: w.confidence,
    wrong: wrong[i] === 1,
    counts: normaliseWords(w.text).length > 0,
  }));
  const withConfidence = scored.filter((w) => w.confidence !== null && w.counts);
  const totalWrong = withConfidence.filter((w) => w.wrong).length;
  const confidence = withConfidence.length
    ? THRESHOLDS.map((threshold) => {
        const below = withConfidence.filter((w) => w.confidence! < threshold);
        const above = withConfidence.filter((w) => w.confidence! >= threshold);
        const wrongIn = (list: typeof withConfidence) => (list.length ? list.filter((w) => w.wrong).length / list.length : 0);
        return {
          threshold,
          below: below.length / withConfidence.length,
          wrongBelow: wrongIn(below),
          wrongAbove: wrongIn(above),
          caught: totalWrong ? below.filter((w) => w.wrong).length / totalWrong : 0,
        };
      })
    : null;

  return {
    refWords: ref.words.length,
    hypWords: hyp.words.length,
    wer: rate.wer,
    sub: rate.sub,
    del: rate.del,
    ins: rate.ins,
    rawWer: raw.wer,
    terms: termScores(ref.words, hyp.words, steps, namesIn(turns.map((t) => t.text))),
    confidence,
    steps,
  };
}

export interface CombinedScores extends SpeakerScores {
  /** Of the script's words the engine wrote something for, the share given the right person. */
  wordsRightSpeaker: number;
}

/** Speakers, and the words given the right person once each label is matched to the person it overlaps most. */
export function scoreSpeakers(
  turns: readonly TimelineTurnRef[],
  words: readonly EngineWord[],
  speakerTurns: readonly SpeakerTurn[],
  steps: readonly Step[],
): CombinedScores {
  const scores = speakerScores(turns, speakerTurns);
  const match = matchLabels(turns, speakerTurns);
  const ref = scriptWords(turns);
  const hyp = engineWords(words);
  const personOf = words.map((w) => {
    const label = speakerAt(speakerTurns, w.startMs, w.endMs);
    return label === null ? null : (match.get(label) ?? null);
  });
  let paired = 0;
  let right = 0;
  for (const s of steps) {
    if (s.op !== 'match' && s.op !== 'sub') continue;
    paired++;
    if (personOf[hyp.from[s.hyp]] === ref.speakers[s.ref]) right++;
  }
  return { ...scores, wordsRightSpeaker: paired ? right / paired : 0 };
}

/**
 * Word errors by person: each substitution and deletion counts against the
 * person whose word it was, and each insertion against the person who spoke
 * the script word before it. Used to check the synthetic voices (decision 2).
 */
export function errorsBySpeaker(
  steps: readonly Step[],
  refSpeakers: readonly string[],
): Record<string, { words: number; errors: number; rate: number }> {
  const out: Record<string, { words: number; errors: number; rate: number }> = {};
  const add = (speaker: string, words: number, errors: number) => {
    const o = (out[speaker] ??= { words: 0, errors: 0, rate: 0 });
    o.words += words;
    o.errors += errors;
  };
  let lastRef = 0;
  for (const s of steps) {
    if (s.op === 'ins') add(refSpeakers[lastRef] ?? refSpeakers[0], 0, 1);
    else {
      lastRef = s.ref;
      add(refSpeakers[s.ref], 1, s.op === 'match' ? 0 : 1);
    }
  }
  for (const o of Object.values(out)) o.rate = o.words ? o.errors / o.words : 0;
  return out;
}
