import { stableStringify } from '../utils/hash.js';
import type { ResourceId } from './types.js';

/** Stable key: object keys inside ids are sorted so `{a,b}` and `{b,a}` match. */
export function serializeResourceId(id: ResourceId): string {
  return stableStringify(id);
}

export function idsMatchPrefix(id: ResourceId, prefix: ResourceId): boolean {
  if (prefix.length > id.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    const a = id[i];
    const b = prefix[i];
    if (a === b) continue;
    if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
      if (stableStringify(a) === stableStringify(b)) continue;
    }
    return false;
  }
  return true;
}
