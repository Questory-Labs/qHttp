import { describe, expect, it, beforeEach, vi } from 'vitest';
import { LocalStorageCacheEngine } from '../../src/cache/local-storage-cache-engine.js';

function createMockStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

describe('LocalStorageCacheEngine', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = createMockStorage();
    vi.stubGlobal('localStorage', storage);
  });

  it('namespaces keys and retrieves values', async () => {
    const cache = new LocalStorageCacheEngine();
    await cache.set('user', { id: 1 });
    const value = await cache.get('user');
    expect(value).toEqual({ id: 1 });
    expect(storage.getItem('qhttp:cache:user')).toBeTruthy();
  });

  it('expires entries on read', async () => {
    const cache = new LocalStorageCacheEngine();
    await cache.set('k', { v: 1 }, 1);
    await new Promise((r) => setTimeout(r, 5));
    expect(await cache.get('k')).toBeUndefined();
  });

  it('evicts oldest entry on quota exceeded', async () => {
    const cache = new LocalStorageCacheEngine();
    storage.setItem('qhttp:cache:old', JSON.stringify({ value: { v: 0 }, expiresAt: Date.now() + 10000 }));
    const originalSet = storage.setItem.bind(storage);
    let calls = 0;
    storage.setItem = (key: string, value: string) => {
      calls += 1;
      if (calls === 1 && key.endsWith('k')) {
        throw new DOMException('quota', 'QuotaExceededError');
      }
      originalSet(key, value);
    };

    await cache.set('k', { v: 1 });
    expect(await cache.get('k')).toEqual({ v: 1 });
  });

  it('clear removes only namespaced keys', async () => {
    const cache = new LocalStorageCacheEngine();
    await cache.set('a', 1);
    storage.setItem('other', 'x');
    await cache.clear();
    expect(await cache.get('a')).toBeUndefined();
    expect(storage.getItem('other')).toBe('x');
  });

  it('deleteByPrefix only removes namespaced keys', async () => {
    const cache = new LocalStorageCacheEngine();
    await cache.set('orders:1', 1);
    await cache.set('orders:2', 2);
    await cache.set('users:1', 3);
    await cache.deleteByPrefix!('orders:');
    expect(await cache.get('orders:1')).toBeUndefined();
    expect(await cache.get('users:1')).toBe(3);
  });
});
