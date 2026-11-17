import type { EngineUsed } from '../model/types.ts';
import type { TranscribedSegment } from './combine.ts';
import type { Speed } from './estimate.ts';

/**
 * What the local server and the page say to each other about transcription
 * (Phase 3 brief, decisions 10 and 17): the shapes only, shared so the two
 * can't drift apart.
 */

/** The heavy jobs that take turns on this computer (decision 10). */
export type HeavyKind = 'transcription' | 'extraction';

export type JobState = 'waiting' | 'preparing' | 'transcribing' | 'speakers' | 'finishing' | 'done' | 'failed' | 'cancelled';

export interface JobView {
  id: string;
  sessionId: string;
  recordingIds: string[];
  state: JobState;
  /** While waiting: what for. */
  waitingFor: HeavyKind | null;
  /** From 0 to 1, across both programs. */
  progress: number;
  audioMs: number;
  estimateMs: number;
  createdAt: string;
  /** When it stopped waiting and started work. */
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

export const isJobOver = (state: JobState) => state === 'done' || state === 'failed' || state === 'cancelled';

/** Where each recording sits in the joined audio, so a segment's time finds its recording (decision 21). */
export interface RecordingSpan {
  fileId: string;
  offsetMs: number;
  durationMs: number;
}

export const RESULT_FORMAT = 'stylecode-transcription-result';

export interface JobResult {
  format: typeof RESULT_FORMAT;
  version: 1;
  jobId: string;
  sessionId: string;
  recordingIds: string[];
  spans: RecordingSpan[];
  segments: TranscribedSegment[];
  transcriber: EngineUsed;
  speakers: EngineUsed;
  audioMs: number;
  finishedAt: string;
}

export interface Gpu {
  name: string;
  memoryMb: number;
  driver: string;
}

/** What Settings shows, and what decides whether Transcribe is offered. */
export interface TranscriptionStatus {
  ready: boolean;
  /** Why not, in words for the consultant; null when ready. */
  reason: string | null;
  setupCommand: string;
  transcriber: EngineUsed;
  speakers: EngineUsed;
  gpu: Gpu | null;
  installed: { id: string; name: string; version: string; licence: string; present: boolean }[];
  /** The transcription going now, if any. */
  busy: JobView | null;
  /** The heavy job running now (decision 10): a new transcription waits for it. */
  heavyNow: HeavyKind | null;
  /** This computer's past speeds, for the estimate shown before Transcribe (decision 17). Lengths and times only. */
  speeds: Speed[];
}

/** The page's hold on the heavy slot for an AI run. */
export interface LeaseView {
  id: string;
  kind: HeavyKind;
  state: 'waiting' | 'running';
  /** While waiting: what for. */
  waitingFor: HeavyKind | null;
}
