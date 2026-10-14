/** FNV-1a 32-bit. Fast, non-cryptographic, stable across runtimes. */
export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** JSON.stringify with sorted object keys so equal objects serialize equally. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    // Null prototype so a `__proto__` key stays an own, serialized property.
    const out: Record<string, unknown> = Object.create(null);
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

let counter = 0;

export function createRequestId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  counter = (counter + 1) % Number.MAX_SAFE_INTEGER;
  return `${Date.now().toString(36)}-${counter.toString(36)}`;
}
