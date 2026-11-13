/**
 * Reading and writing PCM WAV files (Phase 3 brief, decision 3). Pure: bytes
 * in, samples out, and back. Samples are floats from -1 to 1.
 */

export interface Audio {
  sampleRate: number;
  /** One channel; a stereo file is averaged to mono when read. */
  samples: Float32Array;
}

/** Reads a RIFF WAV file: 16-bit integer or 32-bit float PCM, any sample rate, mono or more channels (averaged). */
export function readWav(bytes: Uint8Array): Audio {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (bytes.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a WAV file.');
  let format: { code: number; channels: number; sampleRate: number; bits: number } | null = null;
  let at = 12;
  while (at + 8 <= bytes.length) {
    const id = tag(at);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === 'fmt ') {
      let code = view.getUint16(body, true);
      // WAVE_FORMAT_EXTENSIBLE names the real format in its sub-format GUID.
      if (code === 0xfffe && size >= 26) code = view.getUint16(body + 24, true);
      format = {
        code,
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
    } else if (id === 'data') {
      if (!format) throw new Error('The WAV file has no format before its data.');
      const { code, channels, sampleRate, bits } = format;
      const isInt16 = code === 1 && bits === 16;
      const isFloat32 = code === 3 && bits === 32;
      if (!isInt16 && !isFloat32) throw new Error(`Unsupported WAV format: code ${code}, ${bits} bits.`);
      const width = bits / 8;
      const length = Math.min(size, bytes.length - body);
      const frames = Math.floor(length / (width * channels));
      const samples = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < channels; c++) {
          const p = body + (i * channels + c) * width;
          sum += isInt16 ? view.getInt16(p, true) / 32768 : view.getFloat32(p, true);
        }
        samples[i] = sum / channels;
      }
      return { sampleRate, samples };
    }
    at = body + size + (size % 2);
  }
  throw new Error('The WAV file has no data.');
}

/** Writes 16-bit mono PCM, the format StyleCode records (decision 12). Samples beyond ±1 are clipped. */
export function writeWav16(audio: Audio): Uint8Array {
  const { sampleRate, samples } = audio;
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i);
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, Math.round(s < 0 ? s * 32768 : s * 32767), true);
  }
  return bytes;
}
