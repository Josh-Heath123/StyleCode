/**
 * WAV files for recordings (Phase 3 brief, decisions 12 and 15). Pure: bytes
 * in, bytes out, so the local server and the tests share them.
 *
 * StyleCode keeps every recording as 16 kHz mono 16-bit PCM WAV, the format
 * the engines read. A recording is written as it arrives, with a header whose
 * sizes are filled in when it finishes (`wavHeader`). A WAV made elsewhere is
 * read as it streams in (`readWavHeader`, then `WavConverter`): 16-bit
 * integer or 32-bit float, any sample rate, mono or stereo.
 */
import { Resampler, toInt16 } from './resample.ts';

export const WAV_HEADER_BYTES = 44;

/** The 44-byte header of a 16-bit mono PCM WAV holding `dataBytes` of sound. */
export function wavHeader(dataBytes: number, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(WAV_HEADER_BYTES);
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i);
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, dataBytes, true);
  return bytes;
}

export interface WavFormat {
  encoding: 'int16' | 'float32';
  channels: number;
  sampleRate: number;
  /** Where the sound starts. */
  dataOffset: number;
  /** The sound's length in bytes, or null when the header doesn't say (a file written as it streamed). */
  dataBytes: number | null;
}

/** Why a WAV can't be added, in words for the consultant. */
export class WavError extends Error {}

/** The most a header may hold before the sound, so a file that isn't a WAV can't make the server read on and on. */
export const MAX_WAV_HEADER_BYTES = 1024 * 1024;

/**
 * Reads a WAV's header from its first bytes. Returns null if more bytes are
 * needed to find where the sound starts; throws a `WavError` if the file
 * isn't a WAV StyleCode can take.
 */
export function readWavHeader(bytes: Uint8Array): WavFormat | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (bytes.length < 12) return null;
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE')
    throw new WavError('This isn’t a WAV file. Convert the recording to WAV first, then add it.');
  let format: Omit<WavFormat, 'dataOffset' | 'dataBytes'> | null = null;
  let at = 12;
  while (at + 8 <= bytes.length) {
    const id = tag(at);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === 'data') {
      if (!format) throw new WavError('The WAV file has no format before its sound.');
      return { ...format, dataOffset: body, dataBytes: size === 0 || size === 0xffffffff ? null : size };
    }
    if (id === 'fmt ') {
      if (body + 16 > bytes.length) return null;
      let code = view.getUint16(body, true);
      // WAVE_FORMAT_EXTENSIBLE names the real format in its sub-format GUID.
      if (code === 0xfffe) {
        if (body + 26 > bytes.length) return null;
        code = view.getUint16(body + 24, true);
      }
      const channels = view.getUint16(body + 2, true);
      const sampleRate = view.getUint32(body + 4, true);
      const bits = view.getUint16(body + 14, true);
      const encoding = code === 1 && bits === 16 ? 'int16' : code === 3 && bits === 32 ? 'float32' : null;
      if (!encoding)
        throw new WavError(
          `This WAV file is ${bits}-bit ${code === 3 ? 'float' : 'integer'}. StyleCode takes 16-bit or 32-bit float WAV: convert it first.`,
        );
      if (channels !== 1 && channels !== 2) throw new WavError('StyleCode takes mono or stereo WAV files.');
      if (sampleRate < 8000 || sampleRate > 192_000)
        throw new WavError('The WAV file’s sample rate isn’t one StyleCode can read.');
      format = { encoding, channels, sampleRate };
    }
    at = body + size + (size % 2);
    if (at > MAX_WAV_HEADER_BYTES) throw new WavError('The WAV file’s sound couldn’t be found.');
  }
  return null;
}

/**
 * Converts a WAV's sound, as it streams in, to 16-bit mono at `outRate`:
 * channels averaged, then resampled. Feed it the bytes after the header,
 * in pieces of any size.
 */
export class WavConverter {
  private readonly frameBytes: number;
  private readonly resampler: Resampler;
  private carry = new Uint8Array(0);

  constructor(
    private readonly format: Pick<WavFormat, 'encoding' | 'channels' | 'sampleRate'>,
    outRate: number,
  ) {
    this.frameBytes = (format.encoding === 'int16' ? 2 : 4) * format.channels;
    this.resampler = new Resampler(format.sampleRate, outRate);
  }

  /** The converted sound so far, as 16-bit little-endian bytes. */
  push(chunk: Uint8Array): Uint8Array {
    const bytes = this.carry.length ? concat(this.carry, chunk) : chunk;
    const frames = Math.floor(bytes.length / this.frameBytes);
    this.carry = bytes.slice(frames * this.frameBytes);
    const view = new DataView(bytes.buffer, bytes.byteOffset, frames * this.frameBytes);
    const { channels, encoding } = this.format;
    const mono = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      let sum = 0;
      for (let c = 0; c < channels; c++) {
        const p = (i * channels + c) * (encoding === 'int16' ? 2 : 4);
        sum += encoding === 'int16' ? view.getInt16(p, true) / 32768 : view.getFloat32(p, true);
      }
      mono[i] = sum / channels;
    }
    return asBytes(toInt16(this.resampler.push(mono)));
  }

  /** The rest of the sound, once every byte has been given. */
  finish(): Uint8Array {
    return asBytes(toInt16(this.resampler.flush()));
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

/** 16-bit samples as little-endian bytes. */
export function asBytes(samples: Int16Array): Uint8Array {
  const out = new Uint8Array(samples.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < samples.length; i++) view.setInt16(i * 2, samples[i], true);
  return out;
}
