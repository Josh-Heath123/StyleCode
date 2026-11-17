/**
 * Changing a sound's sample rate, as it streams (Phase 3 brief, decision 12):
 * the microphone's 48 kHz (or whatever the device gives) to the 16 kHz the
 * engines read, and the same for a WAV made elsewhere. Pure, with tests.
 *
 * Each output sample is a windowed-sinc interpolation of the input around it.
 * When the rate goes down, the sinc is widened to cut what's above the new
 * rate's limit, so higher sounds don't fold back into speech as noise.
 */

/** Input samples each side of an output sample, at the output rate. */
const HALF_WIDTH = 10;
/** Positions between two input samples the weights are worked out for; the nearest is used. */
const PHASES = 512;

export class Resampler {
  private readonly step: number;
  private readonly cutoff: number;
  /** Input samples each side, at the input rate. */
  private readonly reach: number;
  private buffer = new Float32Array(0);
  /** The input index of `buffer[0]`. */
  private start = 0;
  /** How many input samples have been given. */
  private given = 0;
  /** The next output sample's position, in input samples: outputs made times the step, so it doesn't drift over hours. */
  private next = 0;
  private made = 0;
  private readonly same: boolean;
  /** For each phase, the weights of the input samples around it, adding up to 1. */
  private readonly table: Float32Array[] = [];

  constructor(inRate: number, outRate: number) {
    if (!(inRate > 0 && outRate > 0)) throw new Error('Sample rates must be positive.');
    this.same = inRate === outRate;
    this.step = inRate / outRate;
    // A little under the new limit, so the window's edge stays out of the speech band's top.
    this.cutoff = Math.min(1, outRate / inRate) * 0.95;
    this.reach = Math.ceil(HALF_WIDTH / this.cutoff);
    for (let p = 0; p <= PHASES; p++) {
      const frac = p / PHASES;
      const weights = new Float32Array(2 * this.reach);
      let sum = 0;
      for (let j = 0; j < weights.length; j++) {
        const x = frac + this.reach - 1 - j;
        weights[j] = kernel(x * this.cutoff) * hann(x / (this.reach + 1));
        sum += weights[j];
      }
      for (let j = 0; j < weights.length; j++) weights[j] /= sum;
      this.table.push(weights);
    }
  }

  /** Output for the samples given so far, leaving what needs later input. */
  push(input: Float32Array): Float32Array {
    if (this.same) return input.slice();
    const merged = new Float32Array(this.buffer.length + input.length);
    merged.set(this.buffer);
    merged.set(input, this.buffer.length);
    this.buffer = merged;
    this.given += input.length;
    return this.drain(false);
  }

  /** The output still owed, treating everything after the input as silence. */
  flush(): Float32Array {
    if (this.same) return new Float32Array(0);
    return this.drain(true);
  }

  private drain(final: boolean): Float32Array {
    const end = this.given;
    const room = Math.max(0, Math.ceil((end - this.next) / this.step) + 1);
    const out = new Float32Array(room);
    let n = 0;
    while (true) {
      const t = this.next;
      if (final ? t >= end : Math.floor(t) + this.reach >= end) break;
      out[n++] = this.at(t);
      this.made += 1;
      this.next = this.made * this.step;
    }
    // Keep only what the next output samples still need.
    const keepFrom = Math.max(this.start, Math.floor(this.next) - this.reach);
    this.buffer = this.buffer.slice(keepFrom - this.start);
    this.start = keepFrom;
    return out.slice(0, n);
  }

  private at(t: number): number {
    const centre = Math.floor(t);
    const weights = this.table[Math.round((t - centre) * PHASES)];
    const first = centre - this.reach + 1 - this.start;
    const buffer = this.buffer;
    let sum = 0;
    if (first >= 0 && first + weights.length <= buffer.length) {
      for (let j = 0; j < weights.length; j++) sum += buffer[first + j] * weights[j];
    } else {
      // At the very start or end, samples outside the sound count as silence.
      for (let j = 0; j < weights.length; j++) {
        const i = first + j;
        if (i >= 0 && i < buffer.length) sum += buffer[i] * weights[j];
      }
    }
    return sum;
  }
}

const kernel = (x: number) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));
const hann = (x: number) => (Math.abs(x) >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * x));

/** Samples from -1 to 1 as 16-bit integers, clipped. */
export function toInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = Math.round(s < 0 ? s * 32768 : s * 32767);
  }
  return out;
}

/** The loudness of a block, from 0 to 1, for the level meter: its peak. */
export function peakLevel(samples: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  return Math.min(1, peak);
}
