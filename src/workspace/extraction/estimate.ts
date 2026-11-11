/**
 * How long a run is likely to take, from how fast the same model read
 * sessions before on this computer (Phase 2, WP7). Pure; where the speeds
 * are kept is the interface's (`ui/extraction/speed.ts`).
 */

/** The runs a speed is averaged over: recent enough to follow a change of settings or hardware. */
export const SPEED_RUNS = 5;

/** The average of the speeds kept, in milliseconds per token of passages, or null with none. */
export function averageSpeed(speeds: readonly number[]): number | null {
  const usable = speeds.filter((s) => Number.isFinite(s) && s > 0).slice(-SPEED_RUNS);
  return usable.length ? usable.reduce((a, b) => a + b, 0) / usable.length : null;
}

/** The speeds with one more run's, keeping the most recent. */
export function withSpeed(speeds: readonly number[], ms: number, tokens: number): number[] {
  if (!(ms > 0) || !(tokens > 0)) return [...speeds];
  return [...speeds, ms / tokens].slice(-SPEED_RUNS);
}

/** A duration as people say it: "less than a minute", "about 12 minutes", "about 1 hour 20 minutes". */
export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'less than a minute';
  if (minutes < 60) return `about ${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round((minutes - hours * 60) / 5) * 5;
  const h = `${hours} hour${hours === 1 ? '' : 's'}`;
  return rest ? `about ${h} ${rest} minutes` : `about ${h}`;
}
