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

export type HeavyKind = 'transcription' | 'extraction';

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
