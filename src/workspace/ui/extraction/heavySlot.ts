import { checkHeavySlot, releaseHeavySlot, takeHeavySlot, WorkspaceApiError } from '../../api';
import type { HeavyKind, LeaseView } from '../../transcription/types';

/** How often a waiting run asks whether it can start. */
const ASK_EVERY_MS = 2000;
/** How often a running AI run says it still holds the slot. The server lets go after 3 minutes without. */
const KEEP_EVERY_MS = 20_000;

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('Stopped.'));
      },
      { once: true },
    );
  });

/**
 * Takes this computer's heavy slot for an AI run on a local model (Phase 3
 * brief, decision 10, as settled at WP3: one heavy job at a time, CPU or
 * GPU). While a transcription has it, the run waits and says so; once it
 * runs, the slot is kept until `release`. If the local server can't hand out
 * slots, the run goes ahead: nothing else would be stopping it.
 */
export async function takeTurn(signal: AbortSignal, onWaiting: (waitingFor: HeavyKind | null) => void): Promise<() => void> {
  let lease: LeaseView;
  try {
    lease = await takeHeavySlot();
  } catch {
    return () => undefined;
  }
  const release = () => void releaseHeavySlot(lease.id).catch(() => undefined);
  try {
    while (lease.state === 'waiting') {
      onWaiting(lease.waitingFor ?? 'transcription');
      await sleep(ASK_EVERY_MS, signal);
      try {
        lease = await checkHeavySlot(lease.id);
      } catch (error) {
        // Let go while asleep, or the server restarted: ask again from the back of the queue.
        if (error instanceof WorkspaceApiError && error.status === 404) lease = await takeHeavySlot();
        else throw error;
      }
    }
  } catch (error) {
    release();
    onWaiting(null);
    throw error;
  }
  onWaiting(null);
  const keep = setInterval(() => void checkHeavySlot(lease.id).catch(() => undefined), KEEP_EVERY_MS);
  return () => {
    clearInterval(keep);
    release();
  };
}
