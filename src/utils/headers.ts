import type { HeadersInit } from '../core/types.js';

export function normalizeHeaderKey(key: string): string {
  return key.toLowerCase();
}

export function mergeHeaders(
  existing: Map<string, string> | undefined,
  incoming: HeadersInit | undefined,
): Map<string, string> {
  const result = new Map(existing ?? []);

  if (!incoming) return result;

  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined) continue;
    result.set(normalizeHeaderKey(key), value);
  }

  return result;
}

export function headersToRecord(headers: Map<string, string>): Record<string, string> {
  const record: Record<string, string> = {};
  for (const [key, value] of headers) {
    record[key] = value;
  }
  return record;
}

export function recordToHeaders(record: Headers | Record<string, string>): Record<string, string> {
  if (record instanceof Headers) {
    const result: Record<string, string> = {};
    record.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }
  return { ...record };
}

export function hasHeader(headers: Map<string, string>, name: string): boolean {
  return headers.has(normalizeHeaderKey(name));
}

export function getHeader(headers: Map<string, string>, name: string): string | undefined {
  return headers.get(normalizeHeaderKey(name));
}

export function setHeader(headers: Map<string, string>, name: string, value: string): void {
  headers.set(normalizeHeaderKey(name), value);
}
