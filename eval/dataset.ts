/**
 * Building the evaluation set's files: the transcript from a platform export
 * (read by the WP2 importer, exactly as the app reads it), and the answer
 * key's segment ids from its turns. Pure apart from what the caller passes.
 */
import type { TranscriptRead } from '../src/workspace/import/read.ts';
import type { AnswerKey, Consultation, EvalTranscript } from './types.ts';

/** The transcript as the scorer and the extraction runs see it: segments s1, s2…, each with its turn. */
export function buildTranscript(id: string, consultation: Consultation, read: TranscriptRead, fileName: string): EvalTranscript {
  let turn = 0;
  let speaker: string | null | undefined;
  const segments = read.segments.map((s, i) => {
    if (i === 0 || s.speakerLabel !== speaker) turn++;
    speaker = s.speakerLabel;
    return {
      id: `s${i + 1}`,
      turn: `T${turn}`,
      speakerLabel: s.speakerLabel,
      startMs: s.startMs,
      endMs: s.endMs,
      text: s.text,
    };
  });
  return {
    consultation: id,
    title: consultation.title,
    startsAt: consultation.startsAt,
    timeZone: consultation.timeZone,
    source: { fileName, layout: read.layout },
    segments,
  };
}

/** The key with each finding's segments filled in from its turns, or the turns that don't exist. */
export function fillSegments(key: AnswerKey, transcript: EvalTranscript): { key: AnswerKey; unknownTurns: string[] } {
  const byTurn = new Map<string, string[]>();
  for (const s of transcript.segments) byTurn.set(s.turn, [...(byTurn.get(s.turn) ?? []), s.id]);
  const unknownTurns: string[] = [];
  const segmentsOf = (turns: string[]) =>
    turns.flatMap((t) => {
      const ids = byTurn.get(t);
      if (!ids) unknownTurns.push(t);
      return ids ?? [];
    });
  return {
    key: {
      ...key,
      findings: key.findings.map((f) => ({ ...f, segments: segmentsOf(f.turns) })),
      notFindings: key.notFindings?.map((n) => ({ ...n, segments: segmentsOf(n.turns) })),
    },
    unknownTurns: [...new Set(unknownTurns)],
  };
}
