import { describe, expect, it, vi } from 'vitest';
import { ResourceStore } from '../../src/resource/resource-store.js';

describe('ResourceStore', () => {
  it('ensure loads and caches data', async () => {
    const store = new ResourceStore();
    const fn = vi.fn(async () => ({ ok: true }));

    const data = await store.ensure(['test'], fn, { freshFor: 60_000 });
    expect(data).toEqual({ ok: true });
    expect(fn).toHaveBeenCalledTimes(1);

    const again = await store.ensure(['test'], fn, { freshFor: 60_000 });
    expect(again).toEqual({ ok: true });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('dedupes concurrent ensure calls', async () => {
    const store = new ResourceStore();
    let resolve!: (v: number) => void;
    const fn = vi.fn(
      () =>
        new Promise<number>((r) => {
          resolve = r;
        }),
    );

    const p1 = store.ensure(['n'], fn);
    const p2 = store.ensure(['n'], fn);
    resolve(42);

    expect(await p1).toBe(42);
    expect(await p2).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('push updates cache without load', () => {
    const store = new ResourceStore();
    store.push(['a'], { v: 1 });
    expect(store.peek(['a'])).toEqual({ v: 1 });
  });

  it('touch marks stale and refetches observed resources', async () => {
    const store = new ResourceStore();
    const fn = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);

    await store.ensure(['x'], fn, { freshFor: 60_000 });
    store.touch(['x']);
    const v = await store.ensure(['x'], fn, { freshFor: 60_000 });
    expect(v).toBe(2);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('touch refetches observed resources', async () => {
    const store = new ResourceStore();
    const fn = vi.fn().mockResolvedValueOnce('a').mockResolvedValueOnce('b');
    store.observe(['obs'], vi.fn());

    await store.ensure(['obs'], fn, { freshFor: 60_000 });
    store.touch(['obs']);

    await vi.waitFor(() => {
      expect(fn).toHaveBeenCalledTimes(2);
      expect(store.peek(['obs'])).toBe('b');
    });
  });

  it('touch matches prefix ids', async () => {
    const store = new ResourceStore();
    const fnA = vi.fn(async () => 'a');
    const fnB = vi.fn(async () => 'b');

    await store.ensure(['music', 'a'], fnA, { freshFor: 60_000 });
    await store.ensure(['watch', 'b'], fnB, { freshFor: 60_000 });

    store.touch(['music']);

    await store.ensure(['music', 'a'], fnA, { freshFor: 60_000 });
    await store.ensure(['watch', 'b'], fnB, { freshFor: 60_000 });

    expect(fnA).toHaveBeenCalledTimes(2);
    expect(fnB).toHaveBeenCalledTimes(1);
  });

  it('does not retry by default', async () => {
    const store = new ResourceStore();
    const fn = vi.fn().mockRejectedValue(new Error('fail'));

    await expect(store.ensure(['default'], fn)).rejects.toThrow('fail');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries failed loads when configured', async () => {
    const store = new ResourceStore();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce('ok');

    const data = await store.ensure(['retry'], fn, {
      retries: 1,
      jitter: false,
      retryDelay: 1,
    });
    expect(data).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry when retries is false', async () => {
    const store = new ResourceStore();
    const fn = vi.fn().mockRejectedValue(new Error('fail'));

    await expect(
      store.ensure(['no-retry'], fn, { retries: false }),
    ).rejects.toThrow('fail');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('delays between resource retries', async () => {
    vi.useFakeTimers();
    const store = new ResourceStore();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce('ok');

    const promise = store.ensure(['retry-delay'], fn, {
      retries: 1,
      retryDelay: 500,
      backoff: 'exponential',
      jitter: false,
    });

    await vi.advanceTimersByTimeAsync(499);
    expect(fn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await promise;
    expect(fn).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('throws after exhausting retries', async () => {
    const store = new ResourceStore();
    const fn = vi.fn().mockRejectedValue(new Error('fail'));

    await expect(
      store.ensure(['max'], fn, { retries: 2, jitter: false, retryDelay: 1 }),
    ).rejects.toThrow('fail');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('ignores stale in-flight results after reload', async () => {
    const store = new ResourceStore();
    let resolveFirst!: (v: string) => void;
    let resolveSecond!: (v: string) => void;

    const first = new Promise<string>((r) => {
      resolveFirst = r;
    });
    const second = new Promise<string>((r) => {
      resolveSecond = r;
    });

    const fn = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);

    const p1 = store.ensure(['race'], fn);
    const p2 = store.reload(['race']);

    resolveSecond('new');
    await expect(p2).resolves.toBe('new');
    expect(store.peek(['race'])).toBe('new');

    resolveFirst('old');
    await expect(p1).resolves.toBe('old');
    expect(store.peek(['race'])).toBe('new');
  });

  it('notifies observers', async () => {
    const store = new ResourceStore();
    const listener = vi.fn();
    store.observe(['sub'], listener);

    await store.ensure(['sub'], async () => 1);
    expect(listener).toHaveBeenCalled();
  });

  it('snapshot reports empty/busy/refreshing', async () => {
    const store = new ResourceStore();
    expect(store.snapshot(['x']).empty).toBe(true);

    let resolve!: (v: number) => void;
    const p = store.ensure(
      ['x'],
      () =>
        new Promise<number>((r) => {
          resolve = r;
        }),
    );

    const mid = store.snapshot<number>(['x']);
    expect(mid.busy).toBe(true);
    expect(mid.empty).toBe(true);
    expect(mid.refreshing).toBe(false);

    resolve(1);
    await p;
    const done = store.snapshot<number>(['x']);
    expect(done.empty).toBe(false);
    expect(done.value).toBe(1);
    expect(done.busy).toBe(false);
  });

  it('drop clears all', () => {
    const store = new ResourceStore();
    store.push(['a'], 1);
    store.drop();
    expect(store.peek(['a'])).toBeUndefined();
  });
});
