/**
 * Wall-clock time in an IANA time zone, with `Intl` only (decision 18).
 */

export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** The date and time an instant shows on a clock in the zone. */
export function wallClock(ms: number, timeZone: string): WallClock {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, format);
  }
  const parts = Object.fromEntries(format.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** How far the zone's clock is ahead of UTC at an instant, in milliseconds. */
export function offsetMs(ms: number, timeZone: string): number {
  const c = wallClock(ms, timeZone);
  return Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second) - Math.floor(ms / 1000) * 1000;
}

const HALF_DAY_MS = 12 * 60 * 60 * 1000;

/**
 * The instant a clock in the zone shows this date and time: the earlier one
 * if the clock shows it twice (when it goes back), and the same time after
 * the change if it never shows it (when it goes forward).
 */
export function fromWallClock(c: WallClock, timeZone: string): number {
  const asUtc = Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second);
  // The zone's offsets either side of the time; at most one change of clock lies between them.
  const offsets = [offsetMs(asUtc - HALF_DAY_MS, timeZone), offsetMs(asUtc + HALF_DAY_MS, timeZone)];
  const shows = (ms: number) => {
    const w = wallClock(ms, timeZone);
    return (
      w.year === c.year &&
      w.month === c.month &&
      w.day === c.day &&
      w.hour === c.hour &&
      w.minute === c.minute &&
      w.second === c.second
    );
  };
  const instants = offsets.map((o) => asUtc - o).filter(shows);
  return instants.length ? Math.min(...instants) : asUtc - offsets[0];
}
