/**
 * Where each turn of a typed meeting falls in its audio (Phase 3 brief,
 * decision 3), and the mix itself. The timeline is the reference every
 * transcription measurement is scored against. Pure and seeded: the same
 * meeting gives the same timeline and the same samples every time.
 */
import { decibels, rms, roomNoise, roomReflections, seededRandom, seedOf, withEcho } from './dsp.ts';

/** One turn as spoken: who, which segments of the typed transcript, and the words. */
export interface SpokenTurn {
  turn: string;
  speaker: string;
  segments: string[];
  text: string;
}

export interface TimelineTurn extends SpokenTurn {
  startMs: number;
  endMs: number;
}

/** `eval/audio/<id>.json`: what the hard version adds to a meeting. */
export interface MeetingAudio {
  /** Short turns ("Mm.", "Ja.") that overlap the end of the turn before them in the hard version. */
  interjections: string[];
  /** A stretch with no speech, only the noise, after a turn, in the hard version (someone fetching a document). */
  pause?: { afterTurn: string; seconds: number };
}

export type Version = 'clean' | 'hard';

export interface Timeline {
  consultation: string;
  version: Version;
  sampleRate: number;
  durationMs: number;
  turns: TimelineTurn[];
}

const LEAD_MS = 1000;
const TAIL_MS = 1000;
/** Gaps between turns: 0.3 to 1.2 seconds (decision 3). */
const GAP_MS = [300, 1200] as const;
/** How far an interjection overlaps the turn before it: up to half a second, and never more than half that turn. */
const OVERLAP_MS = [200, 500] as const;

/**
 * Places the turns in order. The gaps are the same in both versions, drawn
 * from the meeting's id; the hard version moves marked interjections back
 * over the end of the turn before, and adds the pause.
 */
export function placeTurns(
  consultation: string,
  version: Version,
  turns: (SpokenTurn & { durationMs: number })[],
  audio: MeetingAudio,
): { turns: TimelineTurn[]; durationMs: number } {
  const gaps = seededRandom(seedOf(`${consultation}/gaps`));
  const overlaps = seededRandom(seedOf(`${consultation}/overlaps`));
  const interjections = new Set(audio.interjections);
  const placed: TimelineTurn[] = [];
  let free = LEAD_MS; // When the room is quiet again.
  for (const [i, t] of turns.entries()) {
    const gap = Math.round(GAP_MS[0] + gaps() * (GAP_MS[1] - GAP_MS[0]));
    const overlap = Math.round(OVERLAP_MS[0] + overlaps() * (OVERLAP_MS[1] - OVERLAP_MS[0]));
    const before = placed.at(-1);
    let start = i === 0 ? LEAD_MS : free + gap;
    if (version === 'hard' && before && interjections.has(t.turn))
      start = Math.max(before.startMs, before.endMs - Math.min(overlap, Math.floor((before.endMs - before.startMs) / 2)));
    const { durationMs, ...spoken } = t;
    placed.push({ ...spoken, startMs: start, endMs: start + durationMs });
    free = Math.max(free, start + durationMs);
    if (version === 'hard' && audio.pause?.afterTurn === t.turn) free += Math.round(audio.pause.seconds * 1000);
  }
  return { turns: placed, durationMs: free + TAIL_MS };
}

/** Adds each turn's samples at its place in the timeline. */
export function mixTurns(
  placed: TimelineTurn[],
  durationMs: number,
  sampleRate: number,
  audioOf: (turn: string) => Float32Array,
) {
  const out = new Float32Array(Math.ceil((durationMs / 1000) * sampleRate));
  for (const t of placed) {
    const samples = audioOf(t.turn);
    const at = Math.round((t.startMs / 1000) * sampleRate);
    for (let i = 0; i < samples.length && at + i < out.length; i++) out[at + i] += samples[i];
  }
  return out;
}

/** How loud the noise is under the speech in the hard version (decision 3). */
export const NOISE_BELOW_SPEECH_DB = 15;

/**
 * The hard version's room: a short echo on the speech, then pink noise about
 * 15 dB below the speech's loudness over the whole meeting, silence included.
 * `speechLoudness` is the speech's own RMS, measured over the turns only.
 */
export function hardRoom(speech: Float32Array, speechLoudness: number, sampleRate: number, consultation: string): Float32Array {
  const echoed = withEcho(speech, roomReflections(sampleRate, seedOf(`${consultation}/room`))).subarray(0, speech.length);
  const noise = roomNoise(speech.length, speechLoudness * 10 ** (-NOISE_BELOW_SPEECH_DB / 20), seedOf(`${consultation}/noise`));
  const out = new Float32Array(speech.length);
  for (let i = 0; i < out.length; i++) out[i] = echoed[i] + noise[i];
  return out;
}

/** Scales the samples so the loudest is at 0.9, leaving room below clipping. The same scale keeps the noise ratio. */
export function normalise(samples: Float32Array): Float32Array {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  if (!peak) return samples;
  const scale = 0.9 / peak;
  return samples.map((s) => s * scale);
}

export { decibels, rms };
