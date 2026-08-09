/**
 * Interval refresh with exponential backoff on consecutive failures.
 * Stops after `maxFailures`; call `resume()` to try again (e.g. on focus).
 */
export type RefreshSchedulerOptions = {
  getInterval: () => number | false;
  refresh: () => Promise<void>;
  maxFailures?: number;
  maxDelay?: number;
};

export class RefreshScheduler {
  private failures = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private lastInterval: number | false | undefined;
  private readonly maxFailures: number;
  private readonly maxDelay: number;

  constructor(private readonly opts: RefreshSchedulerOptions) {
    this.maxFailures = opts.maxFailures ?? 5;
    this.maxDelay = opts.maxDelay ?? 30_000;
  }

  /** Apply current interval policy. No-op when the resolved interval is unchanged. */
  sync(): void {
    if (this.disposed) return;
    const interval = this.opts.getInterval();
    if (interval === this.lastInterval) return;

    this.lastInterval = interval;
    this.clearTimer();
    this.failures = 0;
    if (interval === false || interval <= 0) return;
    this.schedule(interval);
  }

  /** Clear failure state and re-sync (focus / manual unlock). */
  resume(): void {
    if (this.disposed) return;
    this.failures = 0;
    this.lastInterval = undefined;
    this.sync();
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
  }

  private schedule(ms: number): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      void this.tick();
    }, ms);
  }

  private clearTimer(): void {
    if (this.timer === undefined) return;
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private async tick(): Promise<void> {
    if (this.disposed) return;

    const base = this.opts.getInterval();
    this.lastInterval = base;
    if (base === false || base <= 0) return;

    try {
      await this.opts.refresh();
      this.failures = 0;
      this.schedule(base);
    } catch {
      this.failures += 1;
      if (this.failures >= this.maxFailures) return;
      this.schedule(Math.min(this.maxDelay, base * 2 ** this.failures));
    }
  }
}
