import { useSyncExternalStore } from 'react';
import { downloadFile } from '../../api';

/**
 * Play from here (Phase 3 brief, decision 21): a recording is fetched from
 * the local server with the workspace header and played in the page, from a
 * moment of its transcript. One at a time. Nothing is saved outside
 * StyleCode: the sound is held in the page while it plays, and let go after.
 */
export interface Playing {
  companyId: string;
  fileId: string;
  /** What is playing, as said: "from 12:40", "Speaker 3's longest part". */
  what: string;
  state: 'loading' | 'playing' | 'paused' | 'failed';
  /** Where it is now, in milliseconds from the start of the transcript. */
  atMs: number;
  message: string | null;
}

let current: Playing | null = null;
let audio: HTMLAudioElement | null = null;
/** The sound held for the recording playing, and the transcript time its start is at. */
let loaded: { companyId: string; fileId: string; url: string } | null = null;
let offsetMs = 0;
const listeners = new Set<() => void>();

function publish(changes: Partial<Playing> | null): void {
  current = changes === null ? null : current ? { ...current, ...changes } : null;
  listeners.forEach((l) => l());
}

export function usePlaying(): Playing | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

function element(): HTMLAudioElement {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = 'auto';
  audio.addEventListener('timeupdate', () => current && publish({ atMs: offsetMs + Math.round(audio!.currentTime * 1000) }));
  audio.addEventListener('pause', () => current?.state === 'playing' && publish({ state: 'paused' }));
  audio.addEventListener('playing', () => current && publish({ state: 'playing' }));
  audio.addEventListener('ended', () => current && publish({ state: 'paused' }));
  return audio;
}

/**
 * Plays a recording from `atMs` into it. `recordingStartMs` is where the
 * recording starts in the transcript, so the time shown is the transcript's.
 */
export async function playFrom(
  companyId: string,
  fileId: string,
  atMs: number,
  recordingStartMs: number,
  what: string,
): Promise<void> {
  const player = element();
  player.pause();
  offsetMs = recordingStartMs;
  current = { companyId, fileId, what, state: 'loading', atMs: recordingStartMs + atMs, message: null };
  publish({});
  try {
    if (!loaded || loaded.companyId !== companyId || loaded.fileId !== fileId) {
      letGoOfSound();
      const blob = await downloadFile(companyId, fileId);
      // Another play may have started while this one loaded.
      if (current?.fileId !== fileId || current.companyId !== companyId) return;
      loaded = { companyId, fileId, url: URL.createObjectURL(new Blob([blob], { type: 'audio/wav' })) };
      player.src = loaded.url;
    }
    player.currentTime = atMs / 1000;
    await player.play();
  } catch (e) {
    publish({ state: 'failed', message: `The recording couldn’t be played: ${(e as Error).message}` });
  }
}

/** Pauses, or plays on from where it paused. */
export function togglePlaying(): void {
  if (!audio || !current || current.state === 'loading' || current.state === 'failed') return;
  if (audio.paused) void audio.play().catch(() => undefined);
  else audio.pause();
}

function letGoOfSound(): void {
  if (!loaded) return;
  if (audio) {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }
  URL.revokeObjectURL(loaded.url);
  loaded = null;
}

/** Stops playing and lets the sound go: on closing the player, or when the recording is deleted. */
export function stopPlaying(fileIds?: readonly string[]): void {
  if (fileIds && (!current || !fileIds.includes(current.fileId))) return;
  letGoOfSound();
  publish(null);
}

/** The key that pauses or resumes playing from anywhere in StyleCode: Alt+P (Option+P on a Mac). */
export const isPlayKey = (e: KeyboardEvent) => e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyP';

if (typeof window !== 'undefined')
  window.addEventListener(
    'keydown',
    (e) => {
      if (!isPlayKey(e) || !current) return;
      e.preventDefault();
      e.stopPropagation();
      togglePlaying();
    },
    { capture: true },
  );
