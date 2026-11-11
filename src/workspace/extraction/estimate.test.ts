import { describe, expect, it } from 'vitest';
import { averageSpeed, formatDuration, SPEED_RUNS, withSpeed } from './estimate';

describe('the time a run is likely to take', () => {
  it('averages the recent speeds, and has none before a first run', () => {
    expect(averageSpeed([])).toBeNull();
    let speeds: number[] = [];
    for (let i = 1; i <= SPEED_RUNS + 2; i++) speeds = withSpeed(speeds, i * 1000, 100);
    expect(speeds).toHaveLength(SPEED_RUNS);
    expect(averageSpeed(speeds)).toBe(50);
    expect(withSpeed(speeds, 0, 100)).toEqual(speeds);
    expect(averageSpeed([Number.NaN, -1])).toBeNull();
  });

  it('is said the way people say it', () => {
    expect(formatDuration(20_000)).toBe('less than a minute');
    expect(formatDuration(60_000)).toBe('about 1 minute');
    expect(formatDuration(12.4 * 60_000)).toBe('about 12 minutes');
    expect(formatDuration(60 * 60_000)).toBe('about 1 hour');
    expect(formatDuration(81 * 60_000)).toBe('about 1 hour 20 minutes');
    expect(formatDuration(150 * 60_000)).toBe('about 2 hours 30 minutes');
  });
});
