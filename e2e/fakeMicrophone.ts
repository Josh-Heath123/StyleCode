import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The browser tests' microphone (Phase 3 brief, "Clarifications"): Chromium's
 * fake device plays a WAV the tests generate, a tone, never speech. Chromium
 * loops it, so a recording of any length has sound.
 */
export function fakeMicrophoneWav(): string {
  const dir = join(tmpdir(), 'stylecode-e2e');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'fake-microphone.wav');
  const rate = 48_000;
  const frames = rate * 2;
  const bytes = Buffer.alloc(44 + frames * 2);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(36 + frames * 2, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24);
  bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) bytes.writeInt16LE(Math.round(12_000 * Math.sin((2 * Math.PI * 440 * i) / rate)), 44 + i * 2);
  writeFileSync(path, bytes);
  return path;
}
