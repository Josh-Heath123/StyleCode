import { describe, expect, it } from 'vitest';
import { coolDown, coolingText, mustCool } from './cooling';

/** Temperatures read in turn; the last repeats. */
function gpu(...readings: (number | null)[]) {
  let i = 0;
  return async () => readings[Math.min(i++, readings.length - 1)];
}

const noSleep = async () => undefined;

describe('cooling before a heavy step (decision 10)', () => {
  it('waits from 87 °C, not below', () => {
    expect(mustCool(86)).toBe(false);
    expect(mustCool(87)).toBe(true);
    expect(mustCool(null)).toBe(false);
    expect(coolingText(92)).toBe('Letting the graphics card cool: 92 °C');
  });

  it('starts at once when the GPU is cool enough, or without a reading', async () => {
    const heard: (number | null)[] = [];
    for (const read of [gpu(86), gpu(null), async () => Promise.reject(new Error('no nvidia-smi'))])
      expect(await coolDown({ read, onCooling: (c) => heard.push(c), skip: () => false, sleep: noSleep })).toBe(0);
    expect(heard).toEqual([]);
  });

  it('waits until the GPU is under 75 °C, saying the temperature each time, then clears', async () => {
    const heard: (number | null)[] = [];
    await coolDown({ read: gpu(92, 88, 80, 75, 74), onCooling: (c) => heard.push(c), skip: () => false, sleep: noSleep });
    expect(heard).toEqual([92, 88, 80, 75, null]);
  });

  it('stops waiting when the reading goes, or when the consultant skips it', async () => {
    const heard: (number | null)[] = [];
    await coolDown({ read: gpu(92, null), onCooling: (c) => heard.push(c), skip: () => false, sleep: noSleep });
    expect(heard).toEqual([92, null]);

    let skipped = false;
    const said: (number | null)[] = [];
    await coolDown({
      read: gpu(92),
      onCooling: (c) => said.push(c),
      skip: () => skipped,
      sleep: async () => {
        skipped = true;
      },
    });
    expect(said).toEqual([92, null]);
    expect(await coolDown({ read: gpu(95), onCooling: () => undefined, skip: () => true, sleep: noSleep })).toBe(0);
  });

  it('a stop while waiting ends the wait with the stop', async () => {
    const controller = new AbortController();
    const heard: (number | null)[] = [];
    const waiting = coolDown({
      read: gpu(92),
      onCooling: (c) => heard.push(c),
      skip: () => false,
      signal: controller.signal,
      everyMs: 60_000,
    });
    controller.abort(new Error('Stopped.'));
    await expect(waiting).rejects.toThrow('Stopped.');
    expect(heard).toEqual([92, null]);
  });
});
