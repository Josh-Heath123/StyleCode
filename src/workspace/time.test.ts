import { describe, expect, it } from 'vitest';
import { currentTimeZone } from './model/util';
import {
  formatDateTime,
  formatTimeOfDay,
  fromLocalInput,
  gmtOffset,
  nowToTheMinute,
  sinceStart,
  toLocalInput,
  today,
} from './time';

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

describe('times in the session’s zone (Phase 3 brief, decision 29)', () => {
  const at = '2026-11-05T08:00:00.000Z';
  const here = -new Date(at).getTimezoneOffset();
  // A zone whose clock reads differently from this computer's at that moment, whichever zone the tests run in.
  const [elsewhere, offset] = here === 330 ? ['America/St_Johns', 'GMT-3:30'] : ['Asia/Kolkata', 'GMT+5:30'];

  it('writes the offset as the export does', () => {
    expect(gmtOffset(Date.parse(at), 'Africa/Johannesburg')).toBe('GMT+2');
    expect(gmtOffset(Date.parse(at), 'UTC')).toBe('GMT');
    expect(gmtOffset(Date.parse(at), 'America/St_Johns')).toBe('GMT-3:30');
  });

  it('adds the offset only when the zone’s clock differs from this computer’s', () => {
    expect(formatTimeOfDay(at, elsewhere)).toContain(`(${offset})`);
    expect(formatDateTime(at, elsewhere)).toContain(`(${offset})`);
    expect(formatTimeOfDay(at, currentTimeZone())).not.toContain('GMT');
    expect(formatDateTime(at, currentTimeZone())).not.toContain('GMT');
    expect(formatDateTime(at)).toBe(formatDateTime(at, currentTimeZone()));
  });

  it('shows a zone it can’t read on this computer’s clock', () => {
    expect(formatDateTime(at, 'Not/AZone')).toBe(formatDateTime(at));
    expect(formatTimeOfDay(at, 'Not/AZone')).toBe(formatTimeOfDay(at));
  });
});
