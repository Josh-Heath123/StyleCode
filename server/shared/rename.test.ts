import { describe, expect, it } from 'vitest';
import { readWithRetry, renameWithRetry } from './rename.ts';

const failing = (codes: string[]) => {
  const calls: string[] = [];
  const renameFile = async (from: string, to: string) => {
    calls.push(`${from}>${to}`);
    const code = codes.shift();
    if (code) throw Object.assign(new Error(code), { code });
  };
  return { calls, renameFile };
};

describe('renameWithRetry', () => {
  it('retries while Windows reports the file as busy, then succeeds', async () => {
    const fake = failing(['EBUSY', 'EPERM']);
    await renameWithRetry('a.tmp', 'a.json', { renameFile: fake.renameFile, delayMs: 1 });
    expect(fake.calls).toHaveLength(3);
  });

  it('gives up after the last attempt and throws the error', async () => {
    const fake = failing(['EPERM', 'EPERM', 'EPERM']);
    await expect(
      renameWithRetry('a.tmp', 'a.json', { renameFile: fake.renameFile, delayMs: 1, attempts: 3 }),
    ).rejects.toMatchObject({
      code: 'EPERM',
    });
    expect(fake.calls).toHaveLength(3);
  });

  it('does not retry other errors', async () => {
    const fake = failing(['ENOENT']);
    await expect(renameWithRetry('a.tmp', 'a.json', { renameFile: fake.renameFile, delayMs: 1 })).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(fake.calls).toHaveLength(1);
  });
});

describe('readWithRetry', () => {
  const busy = () => Object.assign(new Error('busy'), { code: 'EBUSY' });

  it('retries a busy file, then reads it', async () => {
    let calls = 0;
    const read = async () => {
      calls++;
      if (calls < 3) throw busy();
      return Buffer.from('ok');
    };
    expect((await readWithRetry('x', { delayMs: 1, readFile: read })).toString()).toBe('ok');
    expect(calls).toBe(3);
  });

  it('gives up on any other error at once, and on a file still busy after the last try', async () => {
    let calls = 0;
    const missing = async () => {
      calls++;
      throw Object.assign(new Error('gone'), { code: 'ENOENT' });
    };
    await expect(readWithRetry('x', { delayMs: 1, readFile: missing })).rejects.toMatchObject({ code: 'ENOENT' });
    expect(calls).toBe(1);
    await expect(
      readWithRetry('x', {
        attempts: 2,
        delayMs: 1,
        readFile: async () => {
          throw busy();
        },
      }),
    ).rejects.toMatchObject({ code: 'EBUSY' });
  });
});
