import { describe, expect, it } from 'vitest';
import { spanAt, spansOfSource } from './play.ts';

const A = '2026-11-05T09:00:00.000Z';
const B = '2026-11-05T09:40:00.000Z';
const C = '2026-11-05T10:10:00.000Z';

describe('play from here (decision 21)', () => {
  const spans = [
    { fileId: 'fi_a', offsetMs: 0, durationMs: 60_000 },
    { fileId: 'fi_b', offsetMs: 60_000, durationMs: 30_000 },
  ];

  it('finds the recording a moment falls in, and where in it', () => {
    expect(spanAt(spans, 0)).toEqual({ fileId: 'fi_a', atMs: 0 });
    expect(spanAt(spans, 59_999)).toEqual({ fileId: 'fi_a', atMs: 59_999 });
    expect(spanAt(spans, 60_000)).toEqual({ fileId: 'fi_b', atMs: 0 });
    expect(spanAt(spans, 75_500)).toEqual({ fileId: 'fi_b', atMs: 15_500 });
    expect(spanAt(spans, 90_000)).toBeNull();
  });

  it('finds an added transcript’s recordings by when they were recorded and how long they were', () => {
    const named = [
      { recordedAt: A, durationMs: 60_000 },
      { recordedAt: B, durationMs: 30_000 },
      { recordedAt: C, durationMs: 20_000 },
    ];
    const kept = [
      { id: 'fi_c', audio: { recordedAt: C, durationMs: 20_000 } },
      { id: 'fi_a', audio: { recordedAt: A, durationMs: 60_000 } },
      // Recorded at B, but not the same length: another recording, not this one.
      { id: 'fi_x', audio: { recordedAt: B, durationMs: 31_000 } },
    ];
    // The one at B was deleted: it still takes its 30 seconds, so the third keeps its place.
    expect(spansOfSource(named, kept)).toEqual([
      { fileId: 'fi_a', offsetMs: 0, durationMs: 60_000 },
      { fileId: 'fi_c', offsetMs: 90_000, durationMs: 20_000 },
    ]);
    expect(spanAt(spansOfSource(named, kept), 70_000)).toBeNull();
    expect(spansOfSource(named, [])).toEqual([]);
  });
});
