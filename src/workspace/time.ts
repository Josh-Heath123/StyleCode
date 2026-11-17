/**
 * Times as the consultant reads and types them: the browser's date and time
 * fields use local time ("2026-11-06T14:30"), the workspace stores UTC
 * timestamps.
 */

import { fromWallClock, offsetMs, wallClock } from './import/zone.ts';

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * A stored timestamp as a `datetime-local` field's value: in this computer's
 * time zone, or on the clock of `timeZone` if given (a session's, decision
 * 29), falling back to this computer's for a zone it can't read.
 */
export function toLocalInput(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (timeZone) {
    try {
      const c = wallClock(d.getTime(), timeZone);
      return `${c.year}-${pad(c.month)}-${pad(c.day)}T${pad(c.hour)}:${pad(c.minute)}`;
    } catch {
      // This computer's clock, below.
    }
  }
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * A `datetime-local` field's value as a stored timestamp, read on this
 * computer's clock or `timeZone`'s, as `toLocalInput` wrote it; null if it
 * isn't a complete date and time.
 */
export function fromLocalInput(value: string, timeZone?: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  if (timeZone) {
    try {
      const [year, month, day, hour, minute] = m.slice(1).map(Number);
      const t = fromWallClock({ year, month, day, hour, minute, second: 0 }, timeZone);
      return Number.isNaN(t) ? null : new Date(t).toISOString();
    } catch {
      // This computer's clock, below.
    }
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Today in this computer's time zone, as a calendar date ("2026-11-06"). */
export function today(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Now, to the minute, as a stored timestamp: the default start of a new session. */
export function nowToTheMinute(now = new Date()): string {
  const d = new Date(now);
  d.setSeconds(0, 0);
  return d.toISOString();
}

/**
 * When a note was written, relative to the session's start (MVP 5.1):
 * "before the start", "at the start", "12 min in", "1 h 5 min in".
 */
export function sinceStart(startsAt: string, writtenAt: string): string {
  const minutes = Math.floor((Date.parse(writtenAt) - Date.parse(startsAt)) / 60_000);
  if (Number.isNaN(minutes)) return '';
  if (minutes < 0) return 'before the start';
  if (minutes === 0) return 'at the start';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h ? `${h} h${m ? ' ' : ''}` : ''}${m ? `${m} min` : ''} in`;
}

const timeOfDay = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

/** A zone's offset from UTC at a moment, written as the export writes it: "GMT+2", "GMT-3:30", "GMT". */
export function gmtOffset(ms: number, timeZone: string): string {
  const offset = Math.round(offsetMs(ms, timeZone) / 60_000);
  const hours = Math.floor(Math.abs(offset) / 60);
  const minutes = Math.abs(offset) % 60;
  return offset === 0 ? 'GMT' : `GMT${offset < 0 ? '-' : '+'}${hours}${minutes ? `:${pad(minutes)}` : ''}`;
}

/**
 * The offset to add to a time shown in a session's zone (Phase 3 brief,
 * decision 29): " (GMT+2)" when that zone's clock reads differently from this
 * computer's at that moment, otherwise nothing. Null for a zone it can't
 * read, so the time is shown on this computer's clock.
 */
function zoneSuffix(ms: number, timeZone: string): string | null {
  try {
    const there = offsetMs(ms, timeZone);
    return there === -new Date(ms).getTimezoneOffset() * 60_000 ? '' : ` (${gmtOffset(ms, timeZone)})`;
  } catch {
    return null;
  }
}

/**
 * A time of day, such as "09:12": on this computer's clock, or in a session's
 * `timeZone` if given, with its offset when that differs from this
 * computer's: "10:00 (GMT+2)".
 */
export function formatTimeOfDay(iso: string, timeZone?: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const suffix = timeZone ? zoneSuffix(t, timeZone) : null;
  return suffix === null
    ? timeOfDay.format(t)
    : `${new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', timeZone }).format(t)}${suffix}`;
}

const dateAndTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * A date and time, such as "5 Nov 2026, 10:00": on this computer's clock, or
 * in a session's `timeZone` if given, with its offset when that differs
 * from this computer's: "5 Nov 2026, 10:00 (GMT+2)" (decision 29).
 */
export function formatDateTime(iso: string, timeZone?: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const suffix = timeZone ? zoneSuffix(t, timeZone) : null;
  return suffix === null
    ? dateAndTime.format(t)
    : `${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(t)}${suffix}`;
}

/** "0:03", "12:40" or "1:02:03": time from the start of the meeting. */
export function formatOffset(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** "1 h 4 min", "12 min 4 s", "45 s": a recording's length. */
export function formatLength(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
  return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.floor(m / 60)} h`;
}
