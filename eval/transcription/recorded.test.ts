import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AnswerKey } from '../types.ts';
import { engineTranscript, translateKey, type TimelineTurn } from './downstream.ts';
import { readRun } from './runs.ts';
import { scoreSpeakers, scoreWords } from './score.ts';

/**
 * One recorded transcription run, scored in CI (Phase 3 brief,
 * "Clarifications"), so the harness can't silently break: whisper.cpp with
 * large-v3-turbo and sherpa-onnx's speakers (CAM++, given the number of
 * people) on Karoo Freight's clean synthetic audio, recorded on the user's
 * laptop. No engine runs in CI.
 */
const HERE = import.meta.dirname;
const json = (...path: string[]) => JSON.parse(readFileSync(join(HERE, ...path), 'utf8'));
const words = readRun(json('recorded', 'whisper-turbo-gpu.karoo-freight-kickoff.clean.json')).words!;
const speakers = readRun(json('recorded', 'speakers-campplus-count.karoo-freight-kickoff.clean.json')).turns!;
const timeline: TimelineTurn[] = json('..', 'audio', 'karoo-freight-kickoff.timeline.json').clean.turns;

describe('a recorded transcription run', () => {
  const scored = scoreWords(timeline, words);

  it('scores as it did when it was recorded', () => {
    expect({ wer: +scored.wer.toFixed(4), sub: scored.sub, del: scored.del, ins: scored.ins }).toEqual({
      wer: 0.0154,
      sub: 9,
      del: 0,
      ins: 0,
    });
    expect({ found: scored.terms.found, of: scored.terms.occurrences }).toEqual({ found: 26, of: 32 });
    const s = scoreSpeakers(timeline, words, speakers, scored.steps);
    expect({
      people: s.people,
      labels: s.labels,
      wrong: +s.wrongSpeaker.toFixed(3),
      right: +s.wordsRightSpeaker.toFixed(3),
    }).toEqual({
      people: 4,
      labels: 3,
      wrong: 0.427,
      right: 0.571,
    });
  });

  it('becomes a transcript and a translated key for the downstream test', () => {
    const transcript = engineTranscript(
      'karoo-freight-kickoff',
      'Karoo',
      'Africa/Johannesburg',
      '2026-11-05T08:00:00.000Z',
      timeline,
      words,
      speakers,
      'recorded',
    );
    expect(transcript.segments.length).toBeGreaterThan(10);
    // Every speaker label is matched to a person in the meeting.
    const people = new Set(timeline.map((t) => t.speaker));
    expect(transcript.segments.every((s) => s.speakerLabel !== null && people.has(s.speakerLabel))).toBe(true);
    const key = json('..', 'consultations', 'karoo-freight-kickoff', 'answer-key.json') as AnswerKey;
    const translated = translateKey(key, timeline, transcript);
    expect(translated.findings.every((f) => f.segments.length > 0)).toBe(true);
    const ids = new Set(transcript.segments.map((s) => s.id));
    expect(translated.findings.flatMap((f) => f.segments).every((id) => ids.has(id))).toBe(true);
  });
});
