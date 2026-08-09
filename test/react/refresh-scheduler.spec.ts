import { describe, expect, it, vi } from 'vitest';
import { RefreshScheduler } from '../../src/react/refresh-scheduler.js';

describe('RefreshScheduler', () => {
  it('backs off then stops after maxFailures', async () => {
    vi.useFakeTimers();
    const refresh = vi.fn().mockRejectedValue(new Error('down'));
    const scheduler = new RefreshScheduler({
      getInterval: () => 100,
      refresh,
      maxFailures: 3,
      maxDelay: 10_000,
    });

    scheduler.sync();
    await vi.runAllTimersAsync();

    expect(refresh).toHaveBeenCalledTimes(3);
    refresh.mockClear();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).toHaveBeenCalledTimes(0);

    scheduler.dispose();
    vi.useRealTimers();
  });

  it('ignores sync when interval is unchanged', async () => {
    vi.useFakeTimers();
    const refresh = vi.fn().mockResolvedValue(undefined);
    const scheduler = new RefreshScheduler({
      getInterval: () => 100,
      refresh,
    });

    scheduler.sync();
    scheduler.sync();
    await vi.advanceTimersByTimeAsync(100);
    expect(refresh).toHaveBeenCalledTimes(1);

    scheduler.dispose();
    vi.useRealTimers();
  });

  it('resume restarts after stop', async () => {
    vi.useFakeTimers();
    const refresh = vi.fn().mockRejectedValue(new Error('down'));
    const scheduler = new RefreshScheduler({
      getInterval: () => 100,
      refresh,
      maxFailures: 2,
    });

    scheduler.sync();
    await vi.runAllTimersAsync();
    expect(refresh).toHaveBeenCalledTimes(2);

    refresh.mockResolvedValue(undefined);
    refresh.mockClear();
    scheduler.resume();
    await vi.advanceTimersByTimeAsync(100);
    expect(refresh).toHaveBeenCalledTimes(1);

    scheduler.dispose();
    vi.useRealTimers();
  });
});
