/**
 * Times as the consultant reads and types them: the browser's date and time
 * fields use local time ("2026-11-06T14:30"), the workspace stores UTC
 * timestamps.
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** A stored timestamp as a `datetime-local` field's value, in this computer's time zone. */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A `datetime-local` field's value as a stored timestamp, or null if it isn't a complete date and time. */
export function fromLocalInput(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
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

/** A time of day, such as "09:12": on this computer's clock, or in `timeZone` if given. */
export function formatTimeOfDay(iso: string, timeZone?: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  return timeZone
    ? new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', timeZone }).format(t)
    : timeOfDay.format(t);
}
