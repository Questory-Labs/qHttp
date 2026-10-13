import { vi } from 'vitest';
import type { HttpAdapter, RawResponseLike } from '../src/core/types.js';
import { mockResponse } from '../src/testing/mock-adapter.js';

export { mockResponse };

/** Adapter whose `send` is a vi.fn returning `{ ok: true }` JSON by default. */
export class SpyAdapter implements HttpAdapter {
  send = vi.fn(async (): Promise<RawResponseLike> => mockResponse({ ok: true }));
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
