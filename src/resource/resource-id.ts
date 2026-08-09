import type { ResourceId } from './types.js';

export function serializeResourceId(id: ResourceId): string {
  return JSON.stringify(id);
}

export function idsMatchPrefix(id: ResourceId, prefix: ResourceId): boolean {
  if (prefix.length > id.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (id[i] !== prefix[i]) return false;
  }
  return true;
}
