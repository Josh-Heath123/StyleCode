/**
 * How well an engine told the speakers apart (Phase 3 brief, decision 8),
 * against the timeline of who really spoke when. Pure.
 *
 * The engine's labels are matched to people as the consultant would match
 * them (decision 20): each label to the person it overlaps most, so a person
 * whose voice was split over two labels is matched by both. The count of
 * labels against people shows such splits (and merges).
 */
import type { SpeakerTurn } from '../../src/workspace/transcription/combine.ts';

/** Who really spoke when: the timeline's turns. */
export interface RefTurn {
  speaker: string;
  startMs: number;
  endMs: number;
}

const FRAME_MS = 10;

/** Each engine label → the person it overlaps most (null if it overlaps no one). */
export function matchLabels(ref: readonly RefTurn[], hyp: readonly SpeakerTurn[]): Map<string, string | null> {
  const overlap = new Map<string, Map<string, number>>();
  for (const h of hyp) {
    const row = overlap.get(h.label) ?? new Map<string, number>();
    overlap.set(h.label, row);
    for (const r of ref) {
      const o = Math.min(h.endMs, r.endMs) - Math.max(h.startMs, r.startMs);
      if (o > 0) row.set(r.speaker, (row.get(r.speaker) ?? 0) + o);
    }
  }
  const out = new Map<string, string | null>();
  for (const [label, row] of overlap) {
    let best: string | null = null;
    let most = 0;
    for (const [speaker, ms] of [...row].sort(([a], [b]) => a.localeCompare(b))) {
      if (ms > most) {
        most = ms;
        best = speaker;
      }
    }
    out.set(label, best);
  }
  return out;
}

export interface SpeakerScores {
  people: number;
  labels: number;
  /** Labels matched to each person: more than one means the engine split their voice. */
  labelsPerPerson: Record<string, number>;
  /** Of the time exactly one person speaks and the engine names someone, the share it names the wrong person. */
  wrongSpeaker: number;
  /** Of the time someone speaks, the share the engine gave no speaker. */
  missed: number;
  /** Of the time the engine names a speaker, the share nobody was speaking. */
  falseSpeech: number;
}

/** Scores the engine's speaker turns frame by frame (10 ms) against the timeline. */
export function speakerScores(ref: readonly RefTurn[], hyp: readonly SpeakerTurn[]): SpeakerScores {
  const match = matchLabels(ref, hyp);
  const end = Math.max(0, ...ref.map((r) => r.endMs), ...hyp.map((h) => h.endMs));
  const frames = Math.ceil(end / FRAME_MS);
  const people = [...new Set(ref.map((r) => r.speaker))].sort();
  const personId = new Map(people.map((p, i) => [p, i + 1]));
  // Who speaks in each frame: 0 nobody, -1 more than one, else the person's id.
  const truth = new Int8Array(frames);
  for (const r of ref) {
    const id = personId.get(r.speaker)!;
    for (let f = Math.floor(r.startMs / FRAME_MS); f < Math.ceil(r.endMs / FRAME_MS); f++)
      truth[f] = truth[f] === 0 || truth[f] === id ? id : -1;
  }
  const said = new Int8Array(frames);
  for (const h of hyp) {
    const person = match.get(h.label);
    const id = person ? personId.get(person)! : -2; // -2: a label matched to nobody.
    for (let f = Math.floor(h.startMs / FRAME_MS); f < Math.ceil(h.endMs / FRAME_MS); f++)
      said[f] = said[f] === 0 || said[f] === id ? id : -1;
  }
  let single = 0;
  let wrong = 0;
  let speech = 0;
  let missed = 0;
  let named = 0;
  let falseSpeech = 0;
  for (let f = 0; f < frames; f++) {
    const t = truth[f];
    const s = said[f];
    if (t !== 0) speech++;
    if (t !== 0 && s === 0) missed++;
    if (s !== 0) named++;
    if (s !== 0 && t === 0) falseSpeech++;
    if (t > 0 && s !== 0) {
      single++;
      if (s !== t) wrong++;
    }
  }
  const labelsPerPerson = Object.fromEntries(people.map((p) => [p, [...match.values()].filter((m) => m === p).length]));
  return {
    people: people.length,
    labels: match.size,
    labelsPerPerson,
    wrongSpeaker: single ? wrong / single : 0,
    missed: speech ? missed / speech : 0,
    falseSpeech: named ? falseSpeech / named : 0,
  };
}
