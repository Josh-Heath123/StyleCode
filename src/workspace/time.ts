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
