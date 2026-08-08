import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QHttp } from '../../src/core/QHttp.js';
import { MemoryCacheEngine } from '../../src/cache/memory-cache-engine.js';
import { resetDefaultCacheEngine } from '../../src/cache/default-cache-engine.js';
import type { HttpAdapter, RawResponseLike } from '../../src/core/types.js';

function mockResponse(body: unknown): RawResponseLike {
  const json = JSON.stringify(body);
  const bytes = new TextEncoder().encode(json);
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json' },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
    arrayBuffer: async () => bytes.buffer,
    json: async () => body,
    text: async () => json,
    blob: async () => new Blob([json]),
  };
}

class MockAdapter implements HttpAdapter {
  send = vi.fn(async () => mockResponse({ items: [1] }));
}

describe('cache', () => {
  beforeEach(() => {
    resetDefaultCacheEngine();
  });

  it('returns cached result without network on second call', async () => {
    const adapter = new MockAdapter();
    const cache = new MemoryCacheEngine();
    const client = new QHttp({ adapter })
      .setBaseUrl('https://api.example.com')
      .setUrl('/orders')
      .cache()
      .cacheEngine(cache)
      .cacheKey('orders:u1');

    const first = await client.get();
    const second = await client.get();

    expect(first.fromCache).toBe(false);
    expect(second.fromCache).toBe(true);
    expect(adapter.send).toHaveBeenCalledOnce();
  });

  it('supports static cache helpers on default engine', async () => {
    await QHttp.setCache('k', { v: 1 }, 1000);
    const value = await QHttp.getCache<{ v: number }>('k');
    expect(value).toEqual({ v: 1 });
    await QHttp.deleteCache('k');
    expect(await QHttp.getCache('k')).toBeUndefined();
  });

  it('cacheWhen can gate reads', async () => {
    const adapter = new MockAdapter();
    const cache = new MemoryCacheEngine();
    const client = new QHttp({ adapter })
      .setBaseUrl('https://api.example.com')
      .cache()
      .cacheEngine(cache)
      .cacheWhen(() => false);

    await client.get('/a');
    await client.get('/a');
    expect(adapter.send).toHaveBeenCalledTimes(2);
  });
});
