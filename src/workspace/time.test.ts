import { describe, expect, it } from 'vitest';
import { fromLocalInput, nowToTheMinute, sinceStart, toLocalInput, today } from './time';

describe('times in date and time fields', () => {
  it('goes from a stored timestamp to the field and back, in local time', () => {
    const iso = new Date(2026, 10, 6, 14, 30).toISOString();
    expect(toLocalInput(iso)).toBe('2026-11-06T14:30');
    expect(fromLocalInput('2026-11-06T14:30')).toBe(iso);
  });

  it('refuses what isn’t a complete date and time', () => {
    for (const value of ['', '2026-11-06', '2026-11-06T', 'tomorrow']) expect(fromLocalInput(value)).toBeNull();
    expect(toLocalInput('not a time')).toBe('');
  });

  it('gives today and now to the minute', () => {
    const now = new Date(2026, 10, 6, 9, 5, 42, 123);
    expect(today(now)).toBe('2026-11-06');
    expect(nowToTheMinute(now)).toBe(new Date(2026, 10, 6, 9, 5).toISOString());
  });
});

describe('when a note was written, from the session’s start', () => {
  const start = '2026-11-04T09:00:00.000Z';
  it('says before, at, or how long into the session', () => {
    expect(sinceStart(start, '2026-11-04T08:55:00.000Z')).toBe('before the start');
    expect(sinceStart(start, '2026-11-04T09:00:40.000Z')).toBe('at the start');
    expect(sinceStart(start, '2026-11-04T09:12:00.000Z')).toBe('12 min in');
    expect(sinceStart(start, '2026-11-04T10:00:00.000Z')).toBe('1 h in');
    expect(sinceStart(start, '2026-11-04T10:05:59.000Z')).toBe('1 h 5 min in');
    expect(sinceStart(start, 'not a time')).toBe('');
  });
});
