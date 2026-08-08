import { describe, expect, it } from 'vitest';
import { MemoryCacheEngine } from '../../src/cache/memory-cache-engine.js';

describe('MemoryCacheEngine', () => {
  it('expires entries by TTL', async () => {
    const cache = new MemoryCacheEngine();
    await cache.set('k', { data: 1 }, 1);
    expect(await cache.get('k')).toEqual({ data: 1 });
    await new Promise((r) => setTimeout(r, 5));
    expect(await cache.get('k')).toBeUndefined();
  });

  it('deleteByPrefix removes matching keys', async () => {
    const cache = new MemoryCacheEngine();
    await cache.set('orders:1', 1);
    await cache.set('orders:2', 2);
    await cache.set('users:1', 3);
    await cache.deleteByPrefix!('orders:');
    expect(await cache.get('orders:1')).toBeUndefined();
    expect(await cache.get('users:1')).toBe(3);
  });
});
