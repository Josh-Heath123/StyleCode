import { averageSpeed, withSpeed } from '../../extraction/estimate';
import type { AiSetup } from './aiSetup';

/**
 * How fast each model read sessions before, in this browser on this
 * computer: milliseconds per token of passages, for the estimate shown before
 * a run. Only timings are kept, never anything from a session.
 */
const KEY = 'stylecode.extraction-speeds';

const modelKey = (setup: Pick<AiSetup, 'provider' | 'baseUrl' | 'model'>) => `${setup.provider} ${setup.baseUrl} ${setup.model}`;

function read(): Record<string, number[]> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number[]>) : {};
  } catch {
    return {};
  }
}

/** The model's speed in milliseconds per token, or null before its first full run here. */
export function speedOf(setup: Pick<AiSetup, 'provider' | 'baseUrl' | 'model'>): number | null {
  const speeds = read()[modelKey(setup)];
  return Array.isArray(speeds) ? averageSpeed(speeds) : null;
}

/** Keeps how long a run that finished took for its passages. */
export function recordSpeed(setup: Pick<AiSetup, 'provider' | 'baseUrl' | 'model'>, ms: number, tokens: number): void {
  try {
    const all = read();
    const key = modelKey(setup);
    all[key] = withSpeed(Array.isArray(all[key]) ? all[key] : [], ms, tokens);
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Without storage there is no estimate next time; the run itself is unaffected.
  }
}
