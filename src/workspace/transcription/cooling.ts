/**
 * Letting the graphics card cool before a heavy step (Phase 3, decision 10 as
 * extended after WP8; `docs/research/TRANSCRIPTION.md`, "Heat"). On the
 * laptop StyleCode was measured on, one long AI run took the GPU to 95 °C
 * and Windows hibernated it. So before a transcription starts, and before
 * each part of an AI run on a local model, a GPU at 87 °C or more is left
 * until it's under 75 °C. The run says so, and the consultant can start
 * without waiting. With no reading (no NVIDIA card, or `nvidia-smi` not
 * answering), nothing waits.
 */

/** At or above this, a heavy step waits. Also the GPU's own target temperature on that laptop. */
export const COOL_FROM_C = 87;
/** It waits until the GPU is under this. */
export const COOL_TO_C = 75;
/** How often a wait reads the temperature again. */
export const COOL_CHECK_MS = 5000;

export const mustCool = (temperatureC: number | null): temperatureC is number =>
  temperatureC !== null && temperatureC >= COOL_FROM_C;

/** What a waiting run says. */
export const coolingText = (temperatureC: number) => `Letting the graphics card cool: ${temperatureC} °C`;

/** What it says it's waiting for. */
export const COOLING_UNTIL = `It starts again when the card is under ${COOL_TO_C} °C.`;

export interface CoolOptions {
  /** The GPU's temperature now, or null without a reading. */
  read: () => Promise<number | null>;
  /** Hears the temperature while waiting, then null when the wait is over. */
  onCooling: (temperatureC: number | null) => void;
  /** True once the consultant has chosen not to wait. */
  skip: () => boolean;
  signal?: AbortSignal;
  everyMs?: number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const sleeping = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error('Stopped.'));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error('Stopped.'));
      },
      { once: true },
    );
  });

/**
 * Waits, if the GPU is too hot, until it has cooled, the reading stops, or
 * the consultant skips the wait. Returns how long it waited, in
 * milliseconds. A reading that fails counts as no reading.
 */
export async function coolDown(options: CoolOptions): Promise<number> {
  const { read, onCooling, skip, signal, everyMs = COOL_CHECK_MS, sleep = sleeping } = options;
  const reading = () => read().catch(() => null);
  if (skip()) return 0;
  let temperature = await reading();
  if (!mustCool(temperature)) return 0;
  const started = Date.now();
  try {
    while (temperature !== null && temperature >= COOL_TO_C && !skip()) {
      onCooling(temperature);
      await sleep(everyMs, signal);
      if (skip()) break;
      temperature = await reading();
    }
  } finally {
    onCooling(null);
  }
  return Date.now() - started;
}
