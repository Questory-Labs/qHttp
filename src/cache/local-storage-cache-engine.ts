import type { CacheSnapshot } from '../core/types.js';
import type { CacheEngine } from './cache-engine.interface.js';

const NAMESPACE = 'qhttp:cache:';

interface StoredEntry {
  value: CacheSnapshot;
  expiresAt?: number;
}

export class LocalStorageCacheEngine implements CacheEngine {
  readonly #namespace: string;

  constructor(namespace = NAMESPACE) {
    this.#namespace = namespace;
  }

  #namespaced(key: string): string {
    return `${this.#namespace}${key}`;
  }

  #getStorage(): Storage | null {
    if (typeof localStorage === 'undefined') {
      return null;
    }
    return localStorage;
  }

  async get(key: string): Promise<CacheSnapshot | undefined> {
    const storage = this.#getStorage();
    if (!storage) return undefined;

    const raw = storage.getItem(this.#namespaced(key));
    if (!raw) return undefined;

    try {
      const entry = JSON.parse(raw) as StoredEntry;
      if (entry.expiresAt !== undefined && Date.now() > entry.expiresAt) {
        storage.removeItem(this.#namespaced(key));
        return undefined;
      }
      return entry.value;
    } catch {
      storage.removeItem(this.#namespaced(key));
      return undefined;
    }
  }

  async set(key: string, value: unknown, ttlMs?: number): Promise<void> {
    const storage = this.#getStorage();
    if (!storage) return;

    const entry: StoredEntry = {
      value: value as CacheSnapshot,
      expiresAt: ttlMs ? Date.now() + ttlMs : undefined,
    };

    try {
      storage.setItem(this.#namespaced(key), JSON.stringify(entry));
    } catch (error) {
      if (this.#isQuotaError(error)) {
        this.#evictOldest(storage);
        storage.setItem(this.#namespaced(key), JSON.stringify(entry));
      }
    }
  }

  async delete(key: string): Promise<void> {
    const storage = this.#getStorage();
    storage?.removeItem(this.#namespaced(key));
  }

  async clear(): Promise<void> {
    const storage = this.#getStorage();
    if (!storage) return;

    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(this.#namespace)) {
        keys.push(key);
      }
    }
    for (const key of keys) {
      storage.removeItem(key);
    }
  }

  async deleteByPrefix(prefix: string): Promise<void> {
    const storage = this.#getStorage();
    if (!storage) return;

    const fullPrefix = this.#namespaced(prefix);
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(fullPrefix)) {
        keys.push(key);
      }
    }
    for (const key of keys) {
      storage.removeItem(key);
    }
  }

  #isQuotaError(error: unknown): boolean {
    return (
      error instanceof DOMException &&
      (error.name === 'QuotaExceededError' || error.code === 22)
    );
  }

  #evictOldest(storage: Storage): void {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(this.#namespace)) {
        storage.removeItem(key);
        return;
      }
    }
  }
}
