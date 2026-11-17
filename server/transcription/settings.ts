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

let temperatureCache: { at: number; reading: Promise<number | null> } | null = null;
/** A reading this recent is reused, so several waits checking at once ask `nvidia-smi` once. */
const TEMPERATURE_FRESH_MS = 2000;

/**
 * The GPU's temperature now, in °C, or null without a reading (no NVIDIA
 * card or driver). For the cooling pause before a heavy step (decision 10).
 * Tests use a fake GPU: with the fake engine, the reading is the number in
 * the file STYLECODE_FAKE_GPU_TEMPERATURE names, or none without that file.
 */
export function gpuTemperature(): Promise<number | null> {
  if (process.env.STYLECODE_TRANSCRIPTION_FAKE === '1') {
    const file = process.env.STYLECODE_FAKE_GPU_TEMPERATURE;
    if (!file) return Promise.resolve(null);
    return readFile(file, 'utf8').then(
      (text) => (Number.isFinite(Number.parseFloat(text)) ? Math.round(Number.parseFloat(text)) : null),
      () => null,
    );
  }
  const at = Date.now();
  if (temperatureCache && at - temperatureCache.at < TEMPERATURE_FRESH_MS) return temperatureCache.reading;
  const reading = new Promise<number | null>((resolve) => {
    execFile(
      'nvidia-smi',
      ['--query-gpu=temperature.gpu', '--format=csv,noheader,nounits'],
      { timeout: 5000, windowsHide: true },
      (error, stdout) => {
        const value = Number.parseFloat(String(stdout).split(/\r?\n/)[0]);
        resolve(error || !Number.isFinite(value) ? null : Math.round(value));
      },
    );
  });
  temperatureCache = { at, reading };
  return reading;
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
