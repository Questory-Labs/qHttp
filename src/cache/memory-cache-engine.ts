import type { CacheEngine } from './cache-engine.interface.js';

interface CacheEntry {
  value: unknown;
  expiresAt?: number;
}

/** LRU in-memory cache. `ttlMs` of `0`/`undefined` means no expiry. */
export class MemoryCacheEngine implements CacheEngine {
  readonly #store = new Map<string, CacheEntry>();
  readonly #maxSize: number;

  constructor(options: { maxSize?: number } = {}) {
    this.#maxSize = options.maxSize ?? 500;
  }

  get size(): number {
    return this.#store.size;
  }

  async get(key: string): Promise<unknown> {
    const entry = this.#store.get(key);
    if (!entry) return undefined;

    if (entry.expiresAt !== undefined && Date.now() > entry.expiresAt) {
      this.#store.delete(key);
      return undefined;
    }

    this.#store.delete(key);
    this.#store.set(key, entry);
    return entry.value;
  }

  async set(key: string, value: unknown, ttlMs?: number): Promise<void> {
    if (this.#store.size >= this.#maxSize && !this.#store.has(key)) {
      const firstKey = this.#store.keys().next().value;
      if (firstKey !== undefined) this.#store.delete(firstKey);
    }

    this.#store.set(key, {
      value,
      expiresAt: ttlMs && Number.isFinite(ttlMs) ? Date.now() + ttlMs : undefined,
    });
  }

  async delete(key: string): Promise<void> {
    this.#store.delete(key);
  }

  async clear(): Promise<void> {
    this.#store.clear();
  }

  async deleteByPrefix(prefix: string): Promise<void> {
    for (const key of [...this.#store.keys()]) {
      if (key.startsWith(prefix)) {
        this.#store.delete(key);
      }
    }
  }
}
