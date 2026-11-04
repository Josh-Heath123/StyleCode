import { describe, expect, it } from 'vitest';
import { renameWithRetry } from './rename.ts';

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
