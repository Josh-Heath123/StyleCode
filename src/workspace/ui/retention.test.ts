import { describe, expect, it } from 'vitest';
import { retentionText } from './retention';

const kept = (k: Parameters<typeof retentionText>[0]['kept']) => ({ kept: k, due: null, waiting: null });

describe('how long a recording is kept, in a line (decisions 22 and 23)', () => {
  it('says how long it is kept, in the session’s zone', () => {
    // 22:30 UTC on 11 December is already 12 December in Johannesburg.
    expect(retentionText(kept({ kind: 'date', at: '2026-12-11T22:30:00.000Z' }), 'Africa/Johannesburg')).toMatch(
      /^Kept until .*12.*2026$/,
    );
    expect(retentionText(kept({ kind: 'engagement-ends' }), 'UTC')).toBe('Kept until the engagement ends');
    expect(retentionText(kept({ kind: 'transcription' }), 'UTC')).toBe(
      'Deleted when its transcript is added, as the client was told',
    );
  });

  it('says why its time is up, or that it waits for its transcript', () => {
    const at = '2026-12-12T08:00:00.000Z';
    expect(retentionText({ kept: { kind: 'date', at }, due: 'days', waiting: null }, 'UTC')).toMatch(
      /^Past its time: it was to be kept until /,
    );
    expect(retentionText({ kept: { kind: 'not-agreed', withdrawn: true }, due: 'withdrawn', waiting: null }, 'UTC')).toBe(
      'Past its time: the client withdrew consent',
    );
    expect(retentionText({ kept: { kind: 'not-agreed', withdrawn: false }, due: 'not-agreed', waiting: null }, 'UTC')).toBe(
      'Past its time: recording is no longer agreed for this session',
    );
    expect(retentionText({ kept: { kind: 'transcription' }, due: null, waiting: 'transcription' }, 'UTC')).toMatch(
      /^Waiting for its transcript/,
    );
    expect(retentionText({ kept: { kind: 'transcription' }, due: null, waiting: 'adding' }, 'UTC')).toMatch(
      /^Its transcript is ready: adding it deletes the recording/,
    );
  });
});
