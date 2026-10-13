import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResourceStore } from '../../src/resource/resource-store.js';
import { idsMatchPrefix, serializeResourceId } from '../../src/resource/resource-id.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('ResourceStore collection and hydration', () => {
  it('collects unobserved entries after gcTime and keeps observed ones', async () => {
    vi.useFakeTimers();
    const store = new ResourceStore({ gcTime: 1_000 });
    await store.ensure(['a'], async () => 1);
    const unsubscribe = store.observe(['b'], () => {});
    await store.ensure(['b'], async () => 2);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(store.has(['a'])).toBe(false);
    expect(store.has(['b'])).toBe(true);

    unsubscribe();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(store.has(['b'])).toBe(false);
  });

  it('re-observing cancels pending collection', async () => {
    vi.useFakeTimers();
    const store = new ResourceStore({ gcTime: 500 });
    const off = store.observe(['x'], () => {});
    await store.ensure(['x'], async () => 'v');
    off();
    await vi.advanceTimersByTimeAsync(250);
    const off2 = store.observe(['x'], () => {});
    await vi.advanceTimersByTimeAsync(1_000);
    expect(store.peek(['x'])).toBe('v');
    off2();
  });

  it('gcTime Infinity keeps entries forever', async () => {
    vi.useFakeTimers();
    const store = new ResourceStore({ gcTime: Number.POSITIVE_INFINITY });
    await store.ensure(['keep'], async () => 1);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(store.has(['keep'])).toBe(true);
  });

  it('drop notifies observers so they see an empty snapshot', async () => {
    const store = new ResourceStore();
    const listener = vi.fn();
    store.observe(['d'], listener);
    await store.ensure(['d'], async () => 1);
    listener.mockClear();
    store.drop(['d']);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.snapshot(['d'])).toMatchObject({ empty: true, updatedAt: 0, busy: false });
  });

  it('dehydrate / hydrate round-trip, newer values win', () => {
    const a = new ResourceStore();
    a.push(['one'], { v: 1 });
    a.push(['two', { k: 1 }], 2);
    const data = a.dehydrate();
    expect(data).toHaveLength(2);

    const b = new ResourceStore();
    b.push(['one'], { v: 'newer' });
    b.hydrate(data);
    expect(b.peek(['one'])).toEqual({ v: 'newer' });
    expect(b.peek(['two', { k: 1 }])).toBe(2);
    b.hydrate(data, { overwrite: true });
    expect(b.peek(['one'])).toEqual({ v: 1 });
  });

  it('ids are key-order independent', () => {
    expect(serializeResourceId(['x', { b: 1, a: 2 }])).toBe(serializeResourceId(['x', { a: 2, b: 1 }]));
    expect(idsMatchPrefix(['x', { b: 1, a: 2 }, 'y'], ['x', { a: 2, b: 1 }])).toBe(true);
    const store = new ResourceStore();
    store.push(['q', { b: 1, a: 2 }], 'v');
    expect(store.peek(['q', { a: 2, b: 1 }])).toBe('v');
  });

  it('update applies an updater and global subscribers are notified', () => {
    const store = new ResourceStore();
    const seen: unknown[] = [];
    store.subscribe((id) => seen.push(id));
    store.push(['n'], 1);
    store.update<number>(['n'], (p) => (p ?? 0) + 1);
    expect(store.peek(['n'])).toBe(2);
    expect(seen).toEqual([['n'], ['n']]);
  });
});
