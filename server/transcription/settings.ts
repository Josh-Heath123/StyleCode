import { execFile } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { type Speed } from '../../src/workspace/transcription/estimate.ts';
import type { Gpu } from '../../src/workspace/transcription/types.ts';

export type { Gpu } from '../../src/workspace/transcription/types.ts';
import { settingsFile } from './install.ts';

export { estimate, FIRST_GUESS, type Speed } from '../../src/workspace/transcription/estimate.ts';

/**
 * Transcription's settings, in `~/.stylecode/transcription.json` (Phase 3
 * brief, WP5): the speeds of past runs on this computer, so an estimate
 * (decision 17) comes from the computer's own speed. Nothing about what was
 * said: lengths and times only.
 */

export interface TranscriptionSettings {
  speeds: Speed[];
}

const FORMAT = 'stylecode-transcription-settings';
/** Enough runs to follow the computer as it changes, few enough that one old run can't skew it. */
const KEEP = 10;

export async function readSettings(): Promise<TranscriptionSettings> {
  try {
    const raw = JSON.parse(await readFile(settingsFile(), 'utf8')) as Record<string, unknown>;
    if (raw?.format !== FORMAT || !Array.isArray(raw.speeds)) return { speeds: [] };
    const speeds = (raw.speeds as Speed[]).filter(
      (s) => s && [s.audioMs, s.transcribeMs, s.speakersMs].every((v) => Number.isFinite(v) && v >= 0) && s.audioMs > 0,
    );
    return { speeds: speeds.slice(-KEEP) };
  } catch {
    return { speeds: [] };
  }
}

/** Adds a finished run's speed, keeping the last few. */
export async function recordSpeed(speed: Speed): Promise<void> {
  const settings = await readSettings();
  const next = { format: FORMAT, version: 1, speeds: [...settings.speeds, speed].slice(-KEEP) };
  const file = settingsFile();
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`);
  await rename(temp, file);
}

let gpuCache: Promise<Gpu | null> | null = null;

/** The NVIDIA GPU `nvidia-smi` reports, or null if there's none (or no driver). Asked once. */
export function nvidiaGpu(): Promise<Gpu | null> {
  gpuCache ??= new Promise((resolve) => {
    execFile(
      'nvidia-smi',
      ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader,nounits'],
      { timeout: 10_000, windowsHide: true },
      (error, stdout) => {
        if (error) return resolve(null);
        const [name, memory, driver] = String(stdout)
          .split(/\r?\n/)[0]
          .split(',')
          .map((s) => s.trim());
        resolve(name ? { name, memoryMb: Number(memory) || 0, driver: driver ?? '' } : null);
      },
    );
  });
  return gpuCache;
}
