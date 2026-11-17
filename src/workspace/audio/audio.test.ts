import { describe, expect, it } from 'vitest';
import { peakLevel, Resampler, toInt16 } from './resample.ts';
import { asBytes, readWavHeader, WavConverter, WavError, wavHeader, WAV_HEADER_BYTES } from './wav.ts';

/** Recording audio (Phase 3 brief, decisions 12 and 15): resampling and WAV files. */

const tone = (rate: number, hz: number, seconds: number, amplitude = 0.5) =>
  Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => amplitude * Math.sin((2 * Math.PI * hz * i) / rate));

const rms = (s: Float32Array, from = 0, to = s.length) => {
  let sum = 0;
  for (let i = from; i < to; i++) sum += s[i] * s[i];
  return Math.sqrt(sum / (to - from));
};

/** Runs a whole sound through a resampler in pieces of `size`. */
function resample(input: Float32Array, inRate: number, outRate: number, size = input.length): Float32Array {
  const r = new Resampler(inRate, outRate);
  const parts: Float32Array[] = [];
  for (let at = 0; at < input.length; at += size) parts.push(r.push(input.subarray(at, at + size)));
  parts.push(r.flush());
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

describe('resampling', () => {
  it('keeps speech-band sound: a 440 Hz tone from 48 kHz to 16 kHz keeps its level and pitch', () => {
    const out = resample(tone(48_000, 440, 1), 48_000, 16_000);
    expect(out.length).toBe(16_000);
    // Away from the edges, the level is the tone's: 0.5 / √2.
    expect(rms(out, 1000, 15_000)).toBeCloseTo(0.5 / Math.SQRT2, 2);
    let crossings = 0;
    for (let i = 1001; i < 15_000; i++) if (out[i - 1] < 0 !== out[i] < 0) crossings++;
    expect(crossings / ((14_000 / 16_000) * 2)).toBeCloseTo(440, -1);
  });

  it('cuts what the new rate can’t hold, instead of folding it into the speech', () => {
    // 12 kHz is above 16 kHz's limit of 8 kHz; without the cut it would come back as a 4 kHz tone.
    const out = resample(tone(48_000, 12_000, 1), 48_000, 16_000);
    expect(rms(out, 1000, 15_000)).toBeLessThan(0.01);
  });

  it('gives the same output whatever size the pieces come in', () => {
    const input = tone(44_100, 300, 0.5);
    const whole = resample(input, 44_100, 16_000);
    for (const size of [1, 128, 1000, 4097]) expect(resample(input, 44_100, 16_000, size)).toEqual(whole);
  });

  it('goes up as well as down, and passes the same rate through', () => {
    expect(resample(tone(8000, 300, 1), 8000, 16_000).length).toBe(16_000);
    const same = tone(16_000, 300, 0.1);
    expect(resample(same, 16_000, 16_000)).toEqual(same);
  });

  it('turns samples into 16-bit integers, clipped, and measures a peak', () => {
    expect([...toInt16(Float32Array.from([0, 1, -1, 2, -2, 0.5]))]).toEqual([0, 32767, -32768, 32767, -32768, 16384]);
    expect(peakLevel(Float32Array.from([0.1, -0.7, 0.3]))).toBeCloseTo(0.7);
  });

  it('is fast enough for a 4-hour WAV: a minute of 48 kHz in well under a second', () => {
    const input = tone(48_000, 440, 60);
    const started = performance.now();
    resample(input, 48_000, 16_000, 65_536);
    expect(performance.now() - started).toBeLessThan(800);
  });
});

/** A WAV file of 16-bit or float samples, mono or stereo, with an optional LIST chunk before the sound. */
function wav(
  samples: number[][],
  rate: number,
  encoding: 'int16' | 'float32',
  options: { extensible?: boolean; list?: boolean } = {},
) {
  const channels = samples.length;
  const width = encoding === 'int16' ? 2 : 4;
  const frames = samples[0].length;
  const fmtSize = options.extensible ? 40 : 16;
  const list = options.list ? 8 + 6 : 0;
  const bytes = new Uint8Array(12 + 8 + fmtSize + list + 8 + frames * channels * width);
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string) => [...s].forEach((c, i) => (bytes[at + i] = c.charCodeAt(0)));
  text(0, 'RIFF');
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, fmtSize, true);
  const code = encoding === 'int16' ? 1 : 3;
  view.setUint16(20, options.extensible ? 0xfffe : code, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, rate, true);
  view.setUint16(34, width * 8, true);
  // The sub-format GUID starts 24 bytes into the fmt chunk, with the format code first.
  if (options.extensible) view.setUint16(20 + 24, code, true);
  let at = 20 + fmtSize;
  if (options.list) {
    text(at, 'LIST');
    view.setUint32(at + 4, 6, true);
    at += 14;
  }
  text(at, 'data');
  view.setUint32(at + 4, frames * channels * width, true);
  at += 8;
  for (let i = 0; i < frames; i++)
    for (let c = 0; c < channels; c++) {
      if (encoding === 'int16') view.setInt16(at, Math.round(samples[c][i] * 32767), true);
      else view.setFloat32(at, samples[c][i], true);
      at += width;
    }
  return bytes;
}

describe('WAV files', () => {
  it('writes the header StyleCode records with, and reads it back', () => {
    const header = wavHeader(32_000, 16_000);
    expect(header.length).toBe(WAV_HEADER_BYTES);
    expect(readWavHeader(header)).toEqual({
      encoding: 'int16',
      channels: 1,
      sampleRate: 16_000,
      dataOffset: 44,
      dataBytes: 32_000,
    });
  });

  it('asks for more bytes until it finds the sound, past other chunks', () => {
    const file = wav([[0, 0.5]], 48_000, 'int16', { list: true });
    expect(readWavHeader(file.subarray(0, 30))).toBeNull();
    expect(readWavHeader(file)).toMatchObject({ dataOffset: file.length - 4, dataBytes: 4 });
  });

  it('reads 32-bit float and WAVE_FORMAT_EXTENSIBLE, and a streamed file with no size', () => {
    expect(readWavHeader(wav([[0.1]], 44_100, 'float32'))).toMatchObject({ encoding: 'float32', sampleRate: 44_100 });
    expect(readWavHeader(wav([[0.1]], 44_100, 'int16', { extensible: true }))).toMatchObject({ encoding: 'int16' });
    const streamed = wavHeader(0, 16_000);
    expect(readWavHeader(streamed)?.dataBytes).toBeNull();
  });

  it('refuses what isn’t a WAV it can take, saying what to do', () => {
    expect(() => readWavHeader(new TextEncoder().encode('ID3\u0004 this is an MP3 file'))).toThrow(
      /Convert the recording to WAV/,
    );
    const bits24 = wavHeader(3, 16_000);
    new DataView(bits24.buffer).setUint16(34, 24, true);
    expect(() => readWavHeader(bits24)).toThrow(WavError);
    expect(() => readWavHeader(bits24)).toThrow(/24-bit integer/);
    const six = wavHeader(12, 16_000);
    new DataView(six.buffer).setUint16(22, 6, true);
    expect(() => readWavHeader(six)).toThrow(/mono or stereo/);
  });

  it('converts stereo to mono and any rate to 16 kHz, whatever the pieces', () => {
    const left = [...tone(48_000, 440, 0.25)];
    const file = wav([left, left.map((s) => -s * 0)], 48_000, 'int16');
    const format = readWavHeader(file)!;
    const sound = file.subarray(format.dataOffset);
    const convert = (size: number) => {
      const c = new WavConverter(format, 16_000);
      const parts: number[] = [];
      for (let at = 0; at < sound.length; at += size) parts.push(...c.push(sound.subarray(at, at + size)));
      parts.push(...c.finish());
      return Uint8Array.from(parts);
    };
    const whole = convert(sound.length);
    expect(whole.length).toBe(4000 * 2);
    expect(convert(3)).toEqual(whole);
    const samples = new Int16Array(whole.buffer, whole.byteOffset, whole.length / 2);
    // Half the level: the right channel was silent.
    expect(
      rms(
        Float32Array.from(samples, (s) => s / 32768),
        500,
        3500,
      ),
    ).toBeCloseTo(0.25 / Math.SQRT2, 2);
  });

  it('writes 16-bit samples little-endian', () => {
    expect([...asBytes(Int16Array.from([1, -2]))]).toEqual([1, 0, 0xfe, 0xff]);
  });
});
