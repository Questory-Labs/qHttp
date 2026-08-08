import { describe, expect, it, vi, beforeEach } from 'vitest';
import { getDefaultCacheEngine, resetDefaultCacheEngine } from '../../src/cache/default-cache-engine.js';
import { LocalStorageCacheEngine } from '../../src/cache/local-storage-cache-engine.js';
import { MemoryCacheEngine } from '../../src/cache/memory-cache-engine.js';

describe('default cache engine', () => {
  beforeEach(() => {
    resetDefaultCacheEngine();
  });

  it('returns singleton memory engine in node', () => {
    const a = getDefaultCacheEngine();
    const b = getDefaultCacheEngine();
    expect(a).toBe(b);
    expect(a).toBeInstanceOf(MemoryCacheEngine);
  });

  it('uses localStorage engine when available', () => {
    vi.stubGlobal('localStorage', {
      length: 0,
      clear: () => {},
      getItem: () => null,
      key: () => null,
      removeItem: () => {},
      setItem: () => {},
    });
    resetDefaultCacheEngine();
    expect(getDefaultCacheEngine()).toBeInstanceOf(LocalStorageCacheEngine);
  });
});
