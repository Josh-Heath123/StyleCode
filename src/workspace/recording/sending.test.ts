import { describe, expect, it } from 'vitest';
import { RECORDING_BYTES_PER_SECOND } from '../model/recordings';
import { dueToSend, PIECE_BYTES, SEND_EVERY_MS } from './sending';

describe('dueToSend', () => {
  const twoSeconds = 2 * RECORDING_BYTES_PER_SECOND;

  it('sends once about two seconds of sound wait and the last try was long enough ago', () => {
    expect(dueToSend(twoSeconds, SEND_EVERY_MS)).toBe(true);
    expect(dueToSend(twoSeconds * 30, 60_000)).toBe(true);
  });

  it('waits for more sound', () => {
    expect(dueToSend(twoSeconds - 2, 60_000)).toBe(false);
    expect(dueToSend(0, 60_000)).toBe(false);
  });

  it('tries at most every couple of seconds, so a server that is down is not asked ten times a second', () => {
    expect(dueToSend(twoSeconds * 10, SEND_EVERY_MS - 1)).toBe(false);
    expect(dueToSend(twoSeconds * 10, 100)).toBe(false);
  });

  it('keeps a piece under the server’s 1 MB limit', () => {
    expect(PIECE_BYTES).toBeLessThan(1024 * 1024);
    expect(PIECE_BYTES % 2).toBe(0);
  });
});
