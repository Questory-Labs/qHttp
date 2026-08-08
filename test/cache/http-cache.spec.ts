import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QHttp } from '../../src/core/QHttp.js';
import { MemoryCacheEngine } from '../../src/cache/memory-cache-engine.js';
import { resetDefaultCacheEngine } from '../../src/cache/default-cache-engine.js';
import {
  loadHttpCacheSemantics,
  resetHttpCacheSemanticsForTests,
} from '../../src/cache/http-cache-policy.js';
import type { FinalRequest, HttpAdapter, RawResponseLike } from '../../src/core/types.js';

function mockResponse(
  body: unknown,
  options: {
    status?: number;
    statusText?: string;
    headers?: Record<string, string>;
  } = {},
): RawResponseLike {
  const json = JSON.stringify(body);
  const bytes = new TextEncoder().encode(json);
  return {
    ok: (options.status ?? 200) >= 200 && (options.status ?? 200) < 300,
    status: options.status ?? 200,
    statusText: options.statusText ?? 'OK',
    headers: {
      'content-type': 'application/json',
      ...options.headers,
    },
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
  send = vi.fn(async (_request: FinalRequest) => mockResponse({ items: [1] }));
}

describe('http cache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    resetDefaultCacheEngine();
    resetHttpCacheSemanticsForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a fresh cached response without network on second call', async () => {
    const adapter = new MockAdapter();
    adapter.send.mockResolvedValue(
      mockResponse({ items: [1] }, { headers: { 'cache-control': 'public, max-age=60' } }),
    );

    const cache = new MemoryCacheEngine();
    const client = new QHttp({ adapter })
      .setBaseUrl('https://api.example.com')
      .setUrl('/items')
      .httpCache()
      .cacheEngine(cache);

    const first = await client.get();
    const second = await client.get();

    expect(first.fromCache).toBe(false);
    expect(second.fromCache).toBe(true);
    expect(adapter.send).toHaveBeenCalledOnce();
    expect(second.headers.age).toBeDefined();
  });

  it('revalidates with conditional headers and reuses body on 304', async () => {
    const adapter = new MockAdapter();
    adapter.send
      .mockResolvedValueOnce(
        mockResponse(
          { items: [1] },
          {
            headers: {
              'cache-control': 'max-age=1',
              etag: '"v1"',
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        mockResponse(
          {},
          {
            status: 304,
            statusText: 'Not Modified',
            headers: { etag: '"v1"' },
          },
        ),
      );

    const cache = new MemoryCacheEngine();
    const client = new QHttp({ adapter })
      .setBaseUrl('https://api.example.com')
      .setUrl('/items')
      .httpCache()
      .cacheEngine(cache);

    const first = await client.get();
    vi.advanceTimersByTime(2_000);
    const second = await client.get<{ items: number[] }>();

    expect(first.fromCache).toBe(false);
    expect(second.fromCache).toBe(true);
    expect(second.data).toEqual({ items: [1] });
    expect(adapter.send).toHaveBeenCalledTimes(2);

    const revalidationRequest = adapter.send.mock.calls[1]?.[0];
    expect(revalidationRequest?.headers['if-none-match']).toBe('"v1"');
  });

  it('does not store no-store responses', async () => {
    const adapter = new MockAdapter();
    adapter.send.mockResolvedValue(
      mockResponse({ items: [1] }, { headers: { 'cache-control': 'no-store' } }),
    );

    const cache = new MemoryCacheEngine();
    const client = new QHttp({ adapter })
      .setBaseUrl('https://api.example.com')
      .setUrl('/items')
      .httpCache()
      .cacheEngine(cache);

    await client.get();
    await client.get();

    expect(adapter.send).toHaveBeenCalledTimes(2);
  });

  it('stores private responses in a private cache', async () => {
    const adapter = new MockAdapter();
    adapter.send.mockResolvedValue(
      mockResponse({ items: [1] }, { headers: { 'cache-control': 'private, max-age=60' } }),
    );

    const cache = new MemoryCacheEngine();
    const client = new QHttp({ adapter })
      .setBaseUrl('https://api.example.com')
      .setUrl('/items')
      .httpCache({ shared: false })
      .cacheEngine(cache);

    await client.get();
    await client.get();

    expect(adapter.send).toHaveBeenCalledOnce();
  });

  it('skips private responses in a shared cache', async () => {
    const adapter = new MockAdapter();
    adapter.send.mockResolvedValue(
      mockResponse({ items: [1] }, { headers: { 'cache-control': 'private, max-age=60' } }),
    );

    const cache = new MemoryCacheEngine();
    const client = new QHttp({ adapter })
      .setBaseUrl('https://api.example.com')
      .setUrl('/items')
      .httpCache({ shared: true })
      .cacheEngine(cache);

    await client.get();
    await client.get();

    expect(adapter.send).toHaveBeenCalledTimes(2);
  });

  it('does not reuse a cached response when Vary does not match', async () => {
    const adapter = new MockAdapter();
    adapter.send.mockResolvedValue(
      mockResponse(
        { items: [1] },
        {
          headers: {
            'cache-control': 'max-age=60',
            vary: 'accept',
          },
        },
      ),
    );

    const cache = new MemoryCacheEngine();
    const client = new QHttp({ adapter })
      .setBaseUrl('https://api.example.com')
      .setUrl('/items')
      .httpCache()
      .cacheEngine(cache);

    await client.setHeaders({ Accept: 'application/json' }).get();
    await client.setHeaders({ Accept: 'text/html' }).get();

    expect(adapter.send).toHaveBeenCalledTimes(2);
  });

  it('returns stale immediately during stale-while-revalidate', async () => {
    let resolveRevalidate: (value: RawResponseLike) => void;
    const revalidatePending = new Promise<RawResponseLike>((resolve) => {
      resolveRevalidate = resolve;
    });

    const adapter = new MockAdapter();
    adapter.send
      .mockResolvedValueOnce(
        mockResponse(
          { items: [1] },
          {
            headers: {
              'cache-control': 'max-age=1, stale-while-revalidate=60',
              etag: '"v1"',
            },
          },
        ),
      )
      .mockReturnValueOnce(revalidatePending);

    const cache = new MemoryCacheEngine();
    const client = new QHttp({ adapter })
      .setBaseUrl('https://api.example.com')
      .setUrl('/items')
      .httpCache()
      .cacheEngine(cache);

    await client.get();
    vi.advanceTimersByTime(2_000);

    const stale = await client.get();
    expect(stale.fromCache).toBe(true);
    expect(adapter.send).toHaveBeenCalledTimes(2);

    resolveRevalidate!(
      mockResponse(
        {},
        {
          status: 304,
          statusText: 'Not Modified',
          headers: { etag: '"v1"' },
        },
      ),
    );
    await vi.runAllTimersAsync();
    expect(adapter.send).toHaveBeenCalledTimes(2);
  });

  it('throws a helpful error when http-cache-semantics is missing', async () => {
    vi.resetModules();
    resetHttpCacheSemanticsForTests();
    vi.doMock('http-cache-semantics', () => {
      throw new Error('Cannot find module');
    });

    const { loadHttpCacheSemantics: loadMissing } = await import(
      '../../src/cache/http-cache-policy.js'
    );

    await expect(loadMissing()).rejects.toMatchObject({
      code: 'INVALID_CONFIG',
      message: expect.stringContaining('http-cache-semantics'),
    });

    vi.doUnmock('http-cache-semantics');
    vi.resetModules();
    resetHttpCacheSemanticsForTests();
  });

  it('loads http-cache-semantics when installed', async () => {
    const mod = await loadHttpCacheSemantics();
    expect(mod).toBeDefined();
    expect(typeof mod).toBe('function');
  });
});
