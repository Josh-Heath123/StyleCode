import { RECORDING_BYTES_PER_SECOND } from '../model/recordings';

/**
 * When a recording's sound is sent to the local server, and what it says when
 * that fails (Phase 3 brief, decision 12; the WP6 check-in). Pure, so it is
 * tested without a browser.
 */

/** How often a piece is sent: a crash loses at most about this much. */
export const SEND_EVERY_MS = 2000;
/** The most one request carries, under the server's 1 MB limit (server/workspace/recordings.ts): 16 seconds. */
export const PIECE_BYTES = 16 * RECORDING_BYTES_PER_SECOND;
/** How long pieces can fail before the recording says it isn't being saved. */
export const UNSAVED_AFTER_MS = 10_000;
/** What the recording says while its sound isn't reaching the disk. */
export const UNSAVED_MESSAGE =
  'Not being saved: StyleCode’s local server isn’t answering. Keep this page open; the sound waits here until it’s back.';

/**
 * A microphone that hears nothing at all (WP6 check-in: on the user's laptop,
 * Windows' default was a virtual device that passes silence). A quiet room
 * still peaks well above this; a muted or empty device gives zeros.
 */
export const SILENT_BELOW = 0.001;
/** How long the sound has to stay silent before the recording says so. */
export const SILENT_AFTER_MS = 5000;
export const SILENT_MESSAGE =
  'This microphone isn’t hearing anything. Check it isn’t muted, or stop and choose another in Microphone.';

/** Whether a block of sound, by its peak level (0 to 1), is silence as a muted or empty device gives it. */
export const isSilence = (peak: number): boolean => peak < SILENT_BELOW;

/**
 * Follows the silence block by block: when it began (in milliseconds of sound
 * captured, or null while there is sound), and whether it has lasted long
 * enough to say so. Any sound clears it at once.
 */
export function followSilence(
  silentFromMs: number | null,
  peak: number,
  elapsedMs: number,
): { silentFromMs: number | null; silent: boolean } {
  if (!isSilence(peak)) return { silentFromMs: null, silent: false };
  const from = silentFromMs ?? elapsedMs;
  return { silentFromMs: from, silent: elapsedMs - from >= SILENT_AFTER_MS };
}

/**
 * Whether the sound waiting should be sent now. The sound's own callback asks
 * this as well as the timer: Chrome can slow a hidden tab's timers to once a
 * minute, but not the microphone. A try at most every SEND_EVERY_MS, so a
 * server that's down isn't asked ten times a second.
 */
export const dueToSend = (waitingBytes: number, sinceLastTryMs: number): boolean =>
  waitingBytes >= (SEND_EVERY_MS / 1000) * RECORDING_BYTES_PER_SECOND && sinceLastTryMs >= SEND_EVERY_MS;
