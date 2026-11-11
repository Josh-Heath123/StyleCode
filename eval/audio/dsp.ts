/**
 * The sound processing the test meetings need (Phase 3 brief, decision 3):
 * resampling, a seeded random source, noise and a room echo made by code, so
 * there are no recorded noise files. Pure and deterministic: the same seed
 * gives the same samples on every computer.
 */

/** A seeded random source (mulberry32): numbers from 0 to 1, the same sequence for the same seed. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A whole number from a string, to seed each meeting and each version differently but reproducibly. */
export function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

const sinc = (x: number) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));

/**
 * Changes the sample rate with a windowed-sinc filter (Blackman window). Going
 * down, the filter also removes what the new rate can't hold, so nothing folds
 * back as noise.
 */
export function resample(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return samples.slice();
  const ratio = to / from;
  const cutoff = Math.min(1, ratio) * 0.95;
  const half = Math.ceil(16 / Math.min(1, ratio));
  const out = new Float32Array(Math.round(samples.length * ratio));
  for (let n = 0; n < out.length; n++) {
    const centre = n / ratio;
    const first = Math.max(0, Math.ceil(centre - half));
    const last = Math.min(samples.length - 1, Math.floor(centre + half));
    let sum = 0;
    for (let k = first; k <= last; k++) {
      const d = centre - k;
      const w = 0.42 + 0.5 * Math.cos((Math.PI * d) / half) + 0.08 * Math.cos((2 * Math.PI * d) / half);
      sum += samples[k] * cutoff * sinc(cutoff * d) * w;
    }
    out[n] = sum;
  }
  return out;
}

/** The root mean square of the samples: their loudness. */
export function rms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return samples.length ? Math.sqrt(sum / samples.length) : 0;
}

/** Decibels between two loudnesses: 20 log10(a / b). */
export const decibels = (a: number, b: number) => 20 * Math.log10(a / b);

/**
 * Background noise, like a room's: pink noise (more low than high, as fans and
 * traffic are), from a seeded source, scaled to the loudness given.
 */
export function roomNoise(length: number, loudness: number, seed: number): Float32Array {
  const random = seededRandom(seed);
  const out = new Float32Array(length);
  // Paul Kellet's economy pink-noise filter over white noise.
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i < length; i++) {
    const white = random() * 2 - 1;
    b0 = 0.99765 * b0 + white * 0.099046;
    b1 = 0.963 * b1 + white * 0.2965164;
    b2 = 0.57 * b2 + white * 1.0526913;
    out[i] = b0 + b1 + b2 + white * 0.1848;
  }
  const scale = loudness / (rms(out) || 1);
  for (let i = 0; i < length; i++) out[i] *= scale;
  return out;
}

/** The reflections of a small room: delays (in samples) and gains, decaying over about 150 ms, from a seed. */
export function roomReflections(sampleRate: number, seed: number): { delay: number; gain: number }[] {
  const random = seededRandom(seed);
  const taps: { delay: number; gain: number }[] = [];
  for (let i = 0; i < 24; i++) {
    const ms = 5 + random() * 145;
    const sign = random() < 0.5 ? -1 : 1;
    taps.push({ delay: Math.round((ms / 1000) * sampleRate), gain: sign * 0.45 * Math.exp(-ms / 45) });
  }
  return taps.sort((a, b) => a.delay - b.delay);
}

/** The samples with a room's reflections added. The output is longer by the last reflection's delay. */
export function withEcho(samples: Float32Array, taps: { delay: number; gain: number }[]): Float32Array {
  const tail = taps.length ? taps[taps.length - 1].delay : 0;
  const out = new Float32Array(samples.length + tail);
  out.set(samples);
  for (const { delay, gain } of taps) for (let i = 0; i < samples.length; i++) out[i + delay] += samples[i] * gain;
  return out;
}
