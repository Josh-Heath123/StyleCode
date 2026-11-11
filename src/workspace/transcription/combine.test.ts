import { describe, expect, it } from 'vitest';
import { segmentsFrom, speakerAt, speakerNames, type EngineWord, type SpeakerTurn } from './combine';

/** Putting words and speakers together (Phase 3 brief, decisions 19 and 20). */

const word = (text: string, startMs: number, endMs = startMs + 300, confidence: number | null = 0.9): EngineWord => ({
  text,
  startMs,
  endMs,
  confidence,
});

const turns: SpeakerTurn[] = [
  { label: 'spk_3', startMs: 0, endMs: 2000 },
  { label: 'spk_1', startMs: 2100, endMs: 5000 },
  { label: 'spk_3', startMs: 5200, endMs: 7000 },
];

describe('speakers', () => {
  it('gives a stretch the turn that overlaps it most, or the nearest within two seconds', () => {
    expect(speakerAt(turns, 100, 400)).toBe('spk_3');
    expect(speakerAt(turns, 1900, 2400)).toBe('spk_1');
    expect(speakerAt(turns, 7500, 7800)).toBe('spk_3');
    expect(speakerAt(turns, 12000, 12300)).toBeNull();
  });

  it('names labels Speaker 1, Speaker 2… in the order they first speak', () => {
    expect([...speakerNames(['spk_3', null, 'spk_1', 'spk_3', 'spk_0'])]).toEqual([
      ['spk_3', 'Speaker 1'],
      ['spk_1', 'Speaker 2'],
      ['spk_0', 'Speaker 3'],
    ]);
  });
});

describe('segments', () => {
  it('end where the speaker changes, and keep the lowest confidence of their words', () => {
    const words = [
      word('Morning', 100),
      word('all.', 500, 800, 0.4),
      word('Hi', 2200),
      word('Sam.', 2600),
      word('So,', 5300),
      word('the', 5700),
      word('bins.', 6000),
    ];
    expect(segmentsFrom(words, turns)).toEqual([
      { speakerLabel: 'Speaker 1', startMs: 100, endMs: 800, text: 'Morning all.', confidence: 0.4 },
      { speakerLabel: 'Speaker 2', startMs: 2200, endMs: 2900, text: 'Hi Sam.', confidence: 0.9 },
      { speakerLabel: 'Speaker 1', startMs: 5300, endMs: 6300, text: 'So, the bins.', confidence: 0.9 },
    ]);
  });

  it('end at a sentence once 15 seconds long, and at 30 seconds whatever', () => {
    const long: SpeakerTurn[] = [{ label: 'a', startMs: 0, endMs: 100_000 }];
    // A sentence ends at 10 s (too early to split) and at 16 s (split there).
    const words = Array.from({ length: 70 }, (_, i) => word(i === 20 || i === 32 ? 'end.' : 'word', i * 500, i * 500 + 400));
    const segments = segmentsFrom(words, long);
    expect(segments[0].endMs).toBe(32 * 500 + 400);
    expect(segments[1].startMs).toBe(33 * 500);
    // No sentence ends after that, so the next one stops before passing 30 seconds.
    expect(segments[1].endMs - segments[1].startMs).toBeLessThanOrEqual(30_000);
    expect(segments.every((s) => s.speakerLabel === 'Speaker 1')).toBe(true);
    expect(segments.flatMap((s) => s.text.split(' ')).length).toBe(70);
  });

  it('without speakers, has none, and confidence null where the engine gives none', () => {
    expect(segmentsFrom([word('Hello', 0, 300, null), word('there.', 300, 600, null)], null)).toEqual([
      { speakerLabel: null, startMs: 0, endMs: 600, text: 'Hello there.', confidence: null },
    ]);
  });

  it('leaves out empty words and keeps punctuation tight', () => {
    expect(segmentsFrom([word('Yes', 0), word(' ', 300), word(',', 400), word('fine.', 500)], turns)[0].text).toBe('Yes, fine.');
  });
});
