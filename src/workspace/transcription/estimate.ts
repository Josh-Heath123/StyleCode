/**
 * How long a transcription should take on this computer (Phase 3 brief,
 * decision 17), from the speeds of its past runs. Shared by the server, which
 * gives a running job its estimate, and the page, which shows it before
 * Transcribe. Lengths and times only, nothing about what was said.
 */

export interface Speed {
  /** Milliseconds of audio. */
  audioMs: number;
  transcribeMs: number;
  speakersMs: number;
  at: string;
}

/**
 * Before any run on this computer, the figures WP3 measured on the user's
 * laptop (TRANSCRIPTION.md): Whisper 2.6 minutes per hour of audio, and
 * speakers the slower of 9 to 21 minutes per hour, as the check-in decided.
 * Plus a minute of loading.
 */
export const FIRST_GUESS = { transcribePerAudio: 2.6 / 60, speakersPerAudio: 21 / 60, startMs: 60_000 };

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/** How long a transcription of `audioMs` should take here, in parts, from past runs. */
export function estimate(
  audioMs: number,
  speeds: readonly Speed[],
): { transcribeMs: number; speakersMs: number; totalMs: number } {
  const transcribe = speeds.length ? median(speeds.map((s) => s.transcribeMs / s.audioMs)) : FIRST_GUESS.transcribePerAudio;
  // Speakers' time varied two-fold for the same work (TRANSCRIPTION.md, "Risks"), so the slowest run counts.
  const speakers = speeds.length ? Math.max(...speeds.map((s) => s.speakersMs / s.audioMs)) : FIRST_GUESS.speakersPerAudio;
  const transcribeMs = Math.round(audioMs * transcribe + (speeds.length ? 0 : FIRST_GUESS.startMs / 2));
  const speakersMs = Math.round(audioMs * speakers + (speeds.length ? 0 : FIRST_GUESS.startMs / 2));
  return { transcribeMs, speakersMs, totalMs: transcribeMs + speakersMs };
}
