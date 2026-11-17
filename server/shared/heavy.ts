import { randomBytes } from 'node:crypto';
import type { HeavyKind, LeaseView } from '../../src/workspace/transcription/types.ts';

/**
 * One heavy job at a time (Phase 3 brief, decision 10, as settled at the WP3
 * check-in; `docs/research/TRANSCRIPTION.md`, "Heat"): a transcription, a
 * speakers run or an extraction run waits for the one before to finish, on
 * the CPU or the GPU, and says what it is waiting for. Sharing cost more than
 * waiting, and two at once cut the laptop's power.
 *
 * Both local servers run in StyleCode's one Node process, so they share this
 * queue. Jobs start in the order they asked.
 */

export type { HeavyKind, LeaseView } from '../../src/workspace/transcription/types.ts';

interface Waiting {
  kind: HeavyKind;
  start: () => void;
  signal?: AbortSignal;
}

export class HeavyJobs {
  private running: HeavyKind | null = null;
  private readonly queue: Waiting[] = [];

  /** What is running now, if anything. */
  current(): HeavyKind | null {
    return this.running;
  }

  /** How many jobs are waiting. */
  waiting(): number {
    return this.queue.length;
  }

  /**
   * Runs `task` once nothing else heavy is running. While it waits,
   * `onWait` hears what it waits for. An aborted job leaves the queue.
   */
  async run<T>(
    kind: HeavyKind,
    task: () => Promise<T>,
    options: { onWait?: (behind: HeavyKind) => void; signal?: AbortSignal } = {},
  ): Promise<T> {
    if (this.running !== null || this.queue.length) {
      options.onWait?.(this.running ?? this.queue[this.queue.length - 1].kind);
      await new Promise<void>((resolve, reject) => {
        const entry: Waiting = { kind, start: resolve, signal: options.signal };
        this.queue.push(entry);
        options.signal?.addEventListener(
          'abort',
          () => {
            const at = this.queue.indexOf(entry);
            if (at >= 0) this.queue.splice(at, 1);
            reject(options.signal!.reason ?? new Error('Cancelled.'));
          },
          { once: true },
        );
      });
    }
    this.running = kind;
    try {
      return await task();
    } finally {
      this.running = null;
      const next = this.queue.shift();
      if (next) {
        this.running = next.kind;
        next.start();
      }
    }
  }
}

/** The queue both local servers share. */
export const heavyJobs = new HeavyJobs();

interface Lease extends LeaseView {
  abort: AbortController;
  release: () => void;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * A heavy job the page runs, held by a lease (Phase 3 brief, WP7). An AI
 * extraction run goes part by part from the page, so the page takes the
 * slot before its first part, asks after it (which keeps the lease) while
 * it waits or runs, and lets it go at the end. A lease nobody has asked
 * after for `expireMs` (the tab closed, the computer slept) is let go, so a
 * closed page never holds a transcription back for long. Three minutes,
 * since Chrome can slow a hidden tab's timers to once a minute.
 */
export class HeavyLeases {
  private readonly leases = new Map<string, Lease>();

  constructor(
    private readonly heavy: HeavyJobs = heavyJobs,
    private readonly expireMs = 180_000,
  ) {}

  private view(lease: Lease): LeaseView {
    return { id: lease.id, kind: lease.kind, state: lease.state, waitingFor: lease.waitingFor };
  }

  private keep(lease: Lease): void {
    if (lease.timer) clearTimeout(lease.timer);
    lease.timer = setTimeout(() => this.release(lease.id), this.expireMs);
    lease.timer.unref?.();
  }

  /** Asks for the slot: running at once if it's free, or waiting in turn. */
  take(kind: HeavyKind): LeaseView {
    const lease: Lease = {
      id: `hl_${randomBytes(8).toString('hex')}`,
      kind,
      state: 'waiting',
      waitingFor: null,
      abort: new AbortController(),
      release: () => undefined,
      timer: null,
    };
    this.leases.set(lease.id, lease);
    this.keep(lease);
    void this.heavy
      .run(
        kind,
        () =>
          new Promise<void>((resolve) => {
            lease.state = 'running';
            lease.waitingFor = null;
            lease.release = resolve;
          }),
        { signal: lease.abort.signal, onWait: (behind) => (lease.waitingFor = behind) },
      )
      .catch(() => undefined)
      .finally(() => {
        if (lease.timer) clearTimeout(lease.timer);
        this.leases.delete(lease.id);
      });
    return this.view(lease);
  }

  /** A lease's state, which also keeps it; null once it's gone. */
  check(id: string): LeaseView | null {
    const lease = this.leases.get(id);
    if (!lease) return null;
    this.keep(lease);
    return this.view(lease);
  }

  /** Lets the slot go, or leaves the queue. */
  release(id: string): void {
    const lease = this.leases.get(id);
    if (!lease) return;
    if (lease.state === 'running') lease.release();
    else lease.abort.abort(new Error('Released.'));
  }
}

/** The leases the workspace server hands out. */
export const heavyLeases = new HeavyLeases();
