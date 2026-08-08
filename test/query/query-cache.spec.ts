import { describe, expect, it, vi } from 'vitest';
import { QueryCache } from '../../src/query/query-cache.js';

describe('QueryCache', () => {
  it('fetches and caches data', async () => {
    const cache = new QueryCache();
    const fn = vi.fn(async () => ({ ok: true }));

    const data = await cache.fetchQuery({
      key: ['test'],
      queryFn: fn,
      staleTime: 60_000,
    });

    expect(data).toEqual({ ok: true });
    expect(fn).toHaveBeenCalledTimes(1);

    const again = await cache.fetchQuery({
      key: ['test'],
      queryFn: fn,
      staleTime: 60_000,
    });
    expect(again).toEqual({ ok: true });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('dedupes concurrent fetches', async () => {
    const cache = new QueryCache();
    let resolve!: (v: number) => void;
    const fn = vi.fn(
      () =>
        new Promise<number>((r) => {
          resolve = r;
        }),
    );

    const p1 = cache.fetchQuery({ key: ['n'], queryFn: fn });
    const p2 = cache.fetchQuery({ key: ['n'], queryFn: fn });
    resolve(42);

    expect(await p1).toBe(42);
    expect(await p2).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('setData updates cache without fetch', () => {
    const cache = new QueryCache();
    cache.setData(['a'], { v: 1 });
    expect(cache.getQueryData(['a'])).toEqual({ v: 1 });
  });

  it('invalidate marks stale and refetches', async () => {
    const cache = new QueryCache();
    const fn = vi
      .fn()
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2);

    await cache.fetchQuery({ key: ['x'], queryFn: fn, staleTime: 60_000 });
    cache.invalidate({ queryKey: ['x'] });
    const v = await cache.fetchQuery({ key: ['x'], queryFn: fn, staleTime: 60_000 });
    expect(v).toBe(2);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('invalidate refetches observed queries', async () => {
    const cache = new QueryCache();
    const fn = vi
      .fn()
      .mockResolvedValueOnce('a')
      .mockResolvedValueOnce('b');
    const listener = vi.fn();
    cache.subscribe(['obs'], listener);

    await cache.fetchQuery({ key: ['obs'], queryFn: fn, staleTime: 60_000 });
    cache.invalidate({ queryKey: ['obs'] });

    await vi.waitFor(() => {
      expect(fn).toHaveBeenCalledTimes(2);
      expect(cache.getQueryData(['obs'])).toBe('b');
    });
  });

  it('invalidateQueries matches prefix keys', async () => {
    const cache = new QueryCache();
    const fnA = vi.fn(async () => 'a');
    const fnB = vi.fn(async () => 'b');

    await cache.fetchQuery({ key: ['music', 'a'], queryFn: fnA, staleTime: 60_000 });
    await cache.fetchQuery({ key: ['watch', 'b'], queryFn: fnB, staleTime: 60_000 });

    cache.invalidateQueries({ queryKey: ['music'] });

    await cache.fetchQuery({ key: ['music', 'a'], queryFn: fnA, staleTime: 60_000 });
    await cache.fetchQuery({ key: ['watch', 'b'], queryFn: fnB, staleTime: 60_000 });

    expect(fnA).toHaveBeenCalledTimes(2);
    expect(fnB).toHaveBeenCalledTimes(1);
  });

  it('retries failed fetches', async () => {
    const cache = new QueryCache();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce('ok');

    const data = await cache.fetchQuery({
      key: ['retry'],
      queryFn: fn,
      retry: 1,
    });

    expect(data).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('notifies subscribers', async () => {
    const cache = new QueryCache();
    const listener = vi.fn();
    cache.subscribe(['sub'], listener);

    await cache.fetchQuery({
      key: ['sub'],
      queryFn: async () => 1,
    });

    expect(listener).toHaveBeenCalled();
  });
});
