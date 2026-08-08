import type { CacheEngine } from './cache-engine.interface.js';
import { LocalStorageCacheEngine } from './local-storage-cache-engine.js';
import { MemoryCacheEngine } from './memory-cache-engine.js';

let defaultEngine: CacheEngine | undefined;

export function getDefaultCacheEngine(): CacheEngine {
  if (!defaultEngine) {
    defaultEngine = createDefaultCacheEngine();
  }
  return defaultEngine;
}

export function configureDefaultCacheEngine(engine: CacheEngine): void {
  defaultEngine = engine;
}

export function resetDefaultCacheEngine(): void {
  defaultEngine = undefined;
}

function createDefaultCacheEngine(): CacheEngine {
  if (typeof localStorage !== 'undefined') {
    return new LocalStorageCacheEngine();
  }
  return new MemoryCacheEngine();
}
