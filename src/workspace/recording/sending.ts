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
 * Whether the sound waiting should be sent now. The sound's own callback asks
 * this as well as the timer: Chrome can slow a hidden tab's timers to once a
 * minute, but not the microphone. A try at most every SEND_EVERY_MS, so a
 * server that's down isn't asked ten times a second.
 */
export const dueToSend = (waitingBytes: number, sinceLastTryMs: number): boolean =>
  waitingBytes >= (SEND_EVERY_MS / 1000) * RECORDING_BYTES_PER_SECOND && sinceLastTryMs >= SEND_EVERY_MS;
