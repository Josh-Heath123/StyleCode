import type { Timestamp } from '../model/types.ts';
import type { RecordingSpan } from './types.ts';

/**
 * Play from here (Phase 3 brief, decision 21): where a moment of a transcript
 * made from recordings lies in them. The recordings were joined in order, so
 * a time in the transcript falls in one of them, at an offset. Pure.
 */

/** The recording a moment falls in, and where in it; null if it isn't kept, or the moment is past the end. */
export function spanAt(spans: readonly RecordingSpan[], ms: number): { fileId: string; atMs: number } | null {
  for (const span of spans) {
    if (ms >= span.offsetMs && ms < span.offsetMs + span.durationMs) return { fileId: span.fileId, atMs: ms - span.offsetMs };
  }
  return null;
}

/**
 * The spans of an added transcript's recordings that are still kept. The
 * transcript names each recording by when it was recorded and how long it
 * was, so it stays valid once they're deleted; a recording kept is found by
 * the same two. A deleted one still takes its time, so the later ones keep
 * their places.
 */
export function spansOfSource(
  named: readonly { recordedAt: Timestamp; durationMs: number }[],
  kept: readonly { id: string; audio: { recordedAt: Timestamp; durationMs: number } }[],
): RecordingSpan[] {
  const spans: RecordingSpan[] = [];
  let offsetMs = 0;
  const used = new Set<string>();
  for (const r of named) {
    const file = kept.find((f) => !used.has(f.id) && f.audio.recordedAt === r.recordedAt && f.audio.durationMs === r.durationMs);
    if (file) {
      used.add(file.id);
      spans.push({ fileId: file.id, offsetMs, durationMs: r.durationMs });
    }
    offsetMs += r.durationMs;
  }
  return spans;
}
