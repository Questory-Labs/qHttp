export interface CacheEngine {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  deleteByPrefix?(prefix: string): Promise<void>;
}

export type { CacheEngine as ICacheEngine };
