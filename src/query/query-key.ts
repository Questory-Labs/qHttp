import type { QueryKey } from './types.js';

export function serializeQueryKey(key: QueryKey): string {
  return JSON.stringify(key);
}

export function keysMatchPrefix(key: QueryKey, prefix: QueryKey): boolean {
  if (prefix.length > key.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (key[i] !== prefix[i]) return false;
  }
  return true;
}
