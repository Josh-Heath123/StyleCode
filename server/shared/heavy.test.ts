import { afterEach, describe, expect, it, vi } from 'vitest';
import { HeavyJobs, HeavyLeases } from './heavy.ts';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('HeavyLeases: an AI run holds the heavy slot from the page (decision 10)', () => {
  afterEach(() => vi.useRealTimers());

  it('runs at once when nothing heavy is running, and a transcription waits for it until it is let go', async () => {
    const heavy = new HeavyJobs();
    const leases = new HeavyLeases(heavy);
    const lease = leases.take('extraction');
    expect(lease).toMatchObject({ kind: 'extraction', state: 'running', waitingFor: null });
    expect(heavy.current()).toBe('extraction');

    let transcribed = false;
    const waits: string[] = [];
    const job = heavy.run('transcription', async () => void (transcribed = true), { onWait: (b) => waits.push(b) });
    await tick();
    expect(waits).toEqual(['extraction']);
    expect(transcribed).toBe(false);

    leases.release(lease.id);
    await job;
    expect(transcribed).toBe(true);
    await tick();
    expect(leases.check(lease.id)).toBeNull();
  });

  it('waits behind a transcription, says so, and runs when it ends', async () => {
    const heavy = new HeavyJobs();
    const leases = new HeavyLeases(heavy);
    let finish!: () => void;
    const job = heavy.run('transcription', () => new Promise<void>((resolve) => (finish = resolve)));
    const lease = leases.take('extraction');
    expect(lease).toMatchObject({ state: 'waiting', waitingFor: 'transcription' });
    finish();
    await job;
    await tick();
    expect(leases.check(lease.id)).toMatchObject({ state: 'running', waitingFor: null });
    leases.release(lease.id);
    await tick();
    expect(heavy.current()).toBeNull();
  });

  it('leaves the queue when let go while waiting', async () => {
    const heavy = new HeavyJobs();
    const leases = new HeavyLeases(heavy);
    let finish!: () => void;
    const job = heavy.run('transcription', () => new Promise<void>((resolve) => (finish = resolve)));
    const lease = leases.take('extraction');
    expect(heavy.waiting()).toBe(1);
    leases.release(lease.id);
    await tick();
    expect(heavy.waiting()).toBe(0);
    expect(leases.check(lease.id)).toBeNull();
    finish();
    await job;
    expect(heavy.current()).toBeNull();
  });

  it('lets go of a lease nobody asks after, so a closed page can’t hold a transcription back', async () => {
    vi.useFakeTimers();
    const heavy = new HeavyJobs();
    const leases = new HeavyLeases(heavy, 60_000);
    const lease = leases.take('extraction');
    await vi.advanceTimersByTimeAsync(50_000);
    expect(leases.check(lease.id)?.state).toBe('running');
    // Asking kept it: another 50 seconds is still within the minute.
    await vi.advanceTimersByTimeAsync(50_000);
    expect(heavy.current()).toBe('extraction');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(leases.check(lease.id)).toBeNull();
    expect(heavy.current()).toBeNull();
  });
});
