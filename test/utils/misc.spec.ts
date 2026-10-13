import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  configureDefaultCacheEngine,
  getDefaultCacheEngine,
  resetDefaultCacheEngine,
} from '../../src/cache/default-cache-engine.js';
import { LocalStorageCacheEngine } from '../../src/cache/local-storage-cache-engine.js';
import { MemoryCacheEngine } from '../../src/cache/memory-cache-engine.js';

describe('default cache engine', () => {
  beforeEach(() => {
    resetDefaultCacheEngine();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns a singleton memory engine', () => {
    const a = getDefaultCacheEngine();
    const b = getDefaultCacheEngine();
    expect(a).toBe(b);
    expect(a).toBeInstanceOf(MemoryCacheEngine);
  });

  it('stays in memory even when localStorage exists (persistence is opt-in)', () => {
    vi.stubGlobal('localStorage', {
      length: 0,
      clear: () => {},
      getItem: () => null,
      key: () => null,
      removeItem: () => {},
      setItem: () => {},
    });
    resetDefaultCacheEngine();
    expect(getDefaultCacheEngine()).toBeInstanceOf(MemoryCacheEngine);
  });

  it('can be configured to a persistent engine', () => {
    const engine = new LocalStorageCacheEngine();
    configureDefaultCacheEngine(engine);
    expect(getDefaultCacheEngine()).toBe(engine);
  });
});
