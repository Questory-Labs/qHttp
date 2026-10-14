import type { CacheEngine } from './cache-engine.interface.js';
import { MemoryCacheEngine } from './memory-cache-engine.js';

let defaultEngine: CacheEngine | undefined;

/**
 * The process-wide default engine. In-memory everywhere; opt into
 * `LocalStorageCacheEngine` explicitly when persistence across page loads is
 * wanted, since persisted responses outlive the session that produced them.
 */
export function getDefaultCacheEngine(): CacheEngine {
  if (!defaultEngine) {
    defaultEngine = new MemoryCacheEngine();
  }
  return defaultEngine;
}

export function configureDefaultCacheEngine(engine: CacheEngine): void {
  defaultEngine = engine;
}

export function resetDefaultCacheEngine(): void {
  defaultEngine = undefined;
}
