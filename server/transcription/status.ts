import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { EngineUsed } from '../../src/workspace/model/types.ts';
import { PINNED, SETUP_COMMAND, SPEAKER_ENGINE, TRANSCRIBER, transcriptionHome } from './install.ts';
import { FAKE, programs, type JobView } from './jobs.ts';
import { nvidiaGpu, type Gpu } from './settings.ts';

/**
 * What the app shows in Settings and uses to offer Transcribe (Phase 3 brief,
 * WP5 and WP7): what's installed, the versions, and the GPU. Slice B supports
 * one engine, whisper.cpp's CUDA build: without an NVIDIA GPU it can use,
 * Transcribe isn't offered, and the session says why (TRANSCRIPTION.md,
 * "Decided at the check-in").
 */
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
}

export async function transcriptionStatus(busy: JobView | null): Promise<TranscriptionStatus> {
  const home = transcriptionHome();
  const installed = PINNED.map((f) => ({
    id: f.id,
    name: f.name,
    version: f.version,
    licence: f.licence,
    present: FAKE || existsSync(join(home, f.installed)),
  }));
  const base = { setupCommand: SETUP_COMMAND, transcriber: TRANSCRIBER, speakers: SPEAKER_ENGINE, installed, busy };
  if (FAKE) return { ...base, ready: true, reason: null, gpu: { name: 'Fake GPU for tests', memoryMb: 6144, driver: 'test' } };
  if (process.platform !== 'win32')
    return {
      ...base,
      ready: false,
      reason: 'Transcription runs on Windows for now: StyleCode uses whisper.cpp’s Windows build with CUDA.',
      gpu: null,
    };
  const gpu = await nvidiaGpu();
  if (!programs().installed())
    return {
      ...base,
      ready: false,
      reason: `Transcription isn’t set up on this computer. In StyleCode’s folder, run ${SETUP_COMMAND}, then reload this page.`,
      gpu,
    };
  if (!gpu)
    return {
      ...base,
      ready: false,
      reason: 'This computer has no NVIDIA graphics card that whisper.cpp can use, so StyleCode can’t transcribe here yet.',
      gpu,
    };
  return { ...base, ready: true, reason: null, gpu };
}
