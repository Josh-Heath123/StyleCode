import { describe, expect, it } from 'vitest';
import { RECORDING_BYTES_PER_SECOND } from '../model/recordings';
import { dueToSend, followSilence, PIECE_BYTES, SEND_EVERY_MS, SILENT_AFTER_MS } from './sending';

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

describe('followSilence', () => {
  it('says so once a microphone has given nothing for about 5 seconds, and not before', () => {
    let state = followSilence(null, 0, 1000);
    expect(state).toEqual({ silentFromMs: 1000, silent: false });
    state = followSilence(state.silentFromMs, 0, 1000 + SILENT_AFTER_MS - 100);
    expect(state.silent).toBe(false);
    state = followSilence(state.silentFromMs, 0.0004, 1000 + SILENT_AFTER_MS);
    expect(state).toEqual({ silentFromMs: 1000, silent: true });
  });

  it('clears as soon as sound arrives, and starts counting again after', () => {
    const quietRoom = 0.01;
    expect(followSilence(1000, quietRoom, 9000)).toEqual({ silentFromMs: null, silent: false });
    expect(followSilence(null, 0, 9100)).toEqual({ silentFromMs: 9100, silent: false });
  });
});
