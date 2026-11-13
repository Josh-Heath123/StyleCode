/**
 * The downstream test (Phase 3 brief, decision 8): Phase 2's extraction run
 * on an engine's transcript instead of the typed one, scored against the
 * same answer key. Pure.
 *
 * - **The transcript** is what the app would make (decision 19): the engine's
 *   words and speaker turns put together into segments. Each speaker label
 *   is then matched to the person it overlaps most, as the consultant would
 *   match it (decision 20), so the AI is told who is who as it is for a typed
 *   transcript.
 * - **The key** is translated into this transcript's segments: a key finding
 *   cites the turns of the script, and each turn is a stretch of the audio's
 *   timeline, so it becomes the engine's segments that overlap those
 *   stretches. The scorer then matches proposals to findings by a segment in
 *   common, as before.
 */
import { segmentsFrom, speakerNames, speakerAt } from '../../src/workspace/transcription/combine.ts';
import type { EngineWord, SpeakerTurn } from '../../src/workspace/transcription/combine.ts';
import type { AnswerKey, EvalTranscript } from '../types.ts';
import { matchLabels } from './speakers.ts';

export interface TimelineTurn {
  turn: string;
  speaker: string;
  segments: string[];
  text: string;
  startMs: number;
  endMs: number;
}

/** The engine's transcript as an evaluation transcript, its speakers matched to the people they overlap most. */
export function engineTranscript(
  consultation: string,
  title: string,
  timeZone: string,
  startsAt: string,
  timeline: readonly TimelineTurn[],
  words: readonly EngineWord[],
  speakerTurns: readonly SpeakerTurn[] | null,
  source: string,
): EvalTranscript {
  const segments = segmentsFrom(words, speakerTurns);
  // "Speaker N" back to the engine's label, then to the person it overlaps most.
  const person = new Map<string, string>();
  if (speakerTurns) {
    const names = speakerNames(words.filter((w) => w.text.trim()).map((w) => speakerAt(speakerTurns, w.startMs, w.endMs)));
    const match = matchLabels(timeline, speakerTurns);
    for (const [label, name] of names) {
      const p = match.get(label);
      if (p) person.set(name, p);
    }
  }
  return {
    consultation,
    title,
    startsAt,
    timeZone,
    source: { fileName: source, layout: 'transcribed' },
    segments: segments.map((s, i) => ({
      id: `e${i + 1}`,
      turn: `E${i + 1}`,
      speakerLabel: s.speakerLabel === null ? null : (person.get(s.speakerLabel) ?? s.speakerLabel),
      startMs: s.startMs,
      endMs: s.endMs,
      text: s.text,
    })),
  };
}

/** Whether a stretch of the engine's transcript overlaps a turn enough to count: a quarter of a second, or half the segment. */
const overlaps = (seg: { startMs: number | null; endMs: number | null }, turn: TimelineTurn) => {
  if (seg.startMs === null || seg.endMs === null) return false;
  const o = Math.min(seg.endMs, turn.endMs) - Math.max(seg.startMs, turn.startMs);
  return o >= Math.min(250, (seg.endMs - seg.startMs) / 2) && o > 0;
};

/** The key with each finding's segments translated to the engine transcript's segments, by time. */
export function translateKey(key: AnswerKey, timeline: readonly TimelineTurn[], transcript: EvalTranscript): AnswerKey {
  const byTurn = new Map(timeline.map((t) => [t.turn, t]));
  const segmentsOf = (turns: readonly string[]) => {
    const ids = new Set<string>();
    for (const id of turns) {
      const turn = byTurn.get(id);
      if (!turn) continue;
      for (const s of transcript.segments) if (overlaps(s, turn)) ids.add(s.id);
    }
    return [...ids];
  };
  return {
    ...key,
    findings: key.findings.map((f) => ({ ...f, segments: segmentsOf(f.turns) })),
    notFindings: key.notFindings?.map((n) => ({ ...n, segments: segmentsOf(n.turns) })),
  };
}
