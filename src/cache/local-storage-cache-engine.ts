import type { CacheEngine } from './cache-engine.interface.js';

const NAMESPACE = 'qhttp:cache:';

function readStoredAt(storage: Storage, key: string): number {
  try {
    const parsed = JSON.parse(storage.getItem(key) ?? '') as { storedAt?: number };
    return parsed.storedAt ?? 0;
  } catch {
    return 0;
  }
}

interface StoredEntry {
  value: unknown;
  expiresAt?: number;
  storedAt: number;
}

/**
 * localStorage-backed cache. Writes never throw: on quota pressure the oldest
 * namespaced entries are evicted and the write is retried once, then dropped.
 */
export class LocalStorageCacheEngine implements CacheEngine {
  readonly #namespace: string;

  constructor(namespace = NAMESPACE) {
    this.#namespace = namespace;
  }

  #namespaced(key: string): string {
    return `${this.#namespace}${key}`;
  }

  #getStorage(): Storage | null {
    try {
      if (typeof localStorage === 'undefined') return null;
      return localStorage;
    } catch {
      return null;
    }
  }

  async get(key: string): Promise<unknown> {
    const storage = this.#getStorage();
    if (!storage) return undefined;

    let raw: string | null;
    try {
      raw = storage.getItem(this.#namespaced(key));
    } catch {
      return undefined;
    }
    if (!raw) return undefined;

    try {
      const entry = JSON.parse(raw) as StoredEntry;
      if (entry.expiresAt !== undefined && Date.now() > entry.expiresAt) {
        storage.removeItem(this.#namespaced(key));
        return undefined;
      }
      return entry.value;
    } catch {
      try {
        storage.removeItem(this.#namespaced(key));
      } catch {
        // ignore
      }
      return undefined;
    }
  }

  async set(key: string, value: unknown, ttlMs?: number): Promise<void> {
    const storage = this.#getStorage();
    if (!storage) return;

    const entry: StoredEntry = {
      value,
      expiresAt: ttlMs && Number.isFinite(ttlMs) ? Date.now() + ttlMs : undefined,
      storedAt: Date.now(),
    };
    const serialized = JSON.stringify(entry);
    const fullKey = this.#namespaced(key);

    try {
      storage.setItem(fullKey, serialized);
    } catch (error) {
      if (!this.#isQuotaError(error)) return;
      this.#evictOldest(storage, Math.max(1, Math.ceil(this.#count(storage) / 4)));
      try {
        storage.setItem(fullKey, serialized);
      } catch {
        // Give up silently: cache writes must never fail a request.
      }
    }
  }

  async delete(key: string): Promise<void> {
    const storage = this.#getStorage();
    try {
      storage?.removeItem(this.#namespaced(key));
    } catch {
      // ignore
    }
  }

  async clear(): Promise<void> {
    await this.deleteByPrefix('');
  }

  async deleteByPrefix(prefix: string): Promise<void> {
    const storage = this.#getStorage();
    if (!storage) return;

    const fullPrefix = this.#namespaced(prefix);
    for (const key of this.#keys(storage)) {
      if (key.startsWith(fullPrefix)) {
        try {
          storage.removeItem(key);
        } catch {
          // ignore
        }
      }
    }
  }

  #keys(storage: Storage): string[] {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(this.#namespace)) keys.push(key);
    }
    return keys;
  }

  #count(storage: Storage): number {
    return this.#keys(storage).length;
  }

  #isQuotaError(error: unknown): boolean {
    if (error instanceof DOMException) {
      return (
        error.name === 'QuotaExceededError' ||
        error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
        error.code === 22 ||
        error.code === 1014
      );
    }
    return false;
  }

  /** Evict the `count` oldest entries by `storedAt`. */
  #evictOldest(storage: Storage, count: number): void {
    const candidates: Array<{ key: string; storedAt: number }> = [];
    for (const key of this.#keys(storage)) {
      candidates.push({ key, storedAt: readStoredAt(storage, key) });
    }
    candidates.sort((a, b) => a.storedAt - b.storedAt);
    for (const { key } of candidates.slice(0, count)) {
      try {
        storage.removeItem(key);
      } catch {
        // ignore
      }
    }
  }
}
