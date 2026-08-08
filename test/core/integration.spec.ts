import { describe, expect, it, vi } from 'vitest';
import { QHttp } from '../../src/core/QHttp.js';
import type { HttpAdapter, ProgressEvent, RawResponseLike } from '../../src/core/types.js';
import { QHttpError } from '../../src/errors/qhttp-error.js';
import { MemoryCacheEngine } from '../../src/cache/memory-cache-engine.js';
import { configureDefaultCacheEngine } from '../../src/cache/default-cache-engine.js';

function mockResponse(
  body: unknown,
  init: Partial<RawResponseLike> & { contentType?: string } = {},
): RawResponseLike {
  const json = typeof body === 'string' ? body : JSON.stringify(body);
  const bytes = new TextEncoder().encode(json);
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    headers: init.headers ?? {
      'content-type': init.contentType ?? 'application/json',
      'content-length': String(bytes.byteLength),
    },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
    arrayBuffer: async () => bytes.buffer,
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
    text: async () => json,
    blob: async () => new Blob([json]),
  };
}

class MockAdapter implements HttpAdapter {
  send = vi.fn(async (): Promise<RawResponseLike> => mockResponse({ ok: true }));
}

describe('QHttp integration', () => {
  it('resolves with error result when throwOnError is false', async () => {
    const adapter = new MockAdapter();
    adapter.send.mockResolvedValue(mockResponse({ err: true }, { ok: false, status: 500 }));

    const client = new QHttp({ adapter }).setBaseUrl('https://api.example.com').throwOnError(false);
    const result = await client.get('/fail');
    expect(result.fetchStatus).toBe('error');
    expect(result.error?.code).toBe('HTTP_ERROR');
  });

  it('recovers from onError hook', async () => {
    const adapter = new MockAdapter();
    adapter.send.mockRejectedValue(new Error('network'));

    const client = new QHttp({ adapter })
      .setBaseUrl('https://api.example.com')
      .onError(() => ({
        data: { recovered: true },
        httpStatus: 200,
        statusText: 'OK',
        headers: {},
        ok: true,
        request: { url: '', method: 'GET', headers: {} },
        fetchStatus: 'success',
        fromCache: false,
      }));

    const result = await client.get('/x');
    expect(result.data).toEqual({ recovered: true });
  });

  it('uses custom validateStatus', async () => {
    const adapter = new MockAdapter();
    adapter.send.mockResolvedValue(mockResponse({}, { ok: false, status: 404 }));

    const client = new QHttp({ adapter })
      .setBaseUrl('https://api.example.com')
      .validateStatus((s) => s === 404);

    const result = await client.get('/x');
    expect(result.httpStatus).toBe(404);
  });

  it('reports progress while downloading', async () => {
    const adapter = new MockAdapter();
    const client = new QHttp({ adapter }).setBaseUrl('https://api.example.com');
    const progress: number[] = [];
    client.onProgress((e) => {
      if (e.direction === 'download') progress.push(e.loaded);
    });

    await client.get('/x');
    expect(progress.length).toBeGreaterThan(0);
  });

  it('reports upload progress for known-size bodies', async () => {
    const adapter = new MockAdapter();
    adapter.send.mockImplementation(async (request) => {
      if (request.body instanceof ReadableStream) {
        const reader = request.body.getReader();
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
      }
      return mockResponse({ ok: true });
    });

    const uploads: ProgressEvent[] = [];
    const client = new QHttp({ adapter })
      .setBaseUrl('https://api.example.com')
      .setBody({ hello: 'world' })
      .onProgress((e) => {
        if (e.direction === 'upload') uploads.push(e);
      });

    await client.post('/x');
    expect(uploads.length).toBeGreaterThan(0);
    expect(uploads.at(-1)?.total).toBe(uploads.at(-1)?.loaded);
    expect(adapter.send.mock.calls[0][0].duplex).toBe('half');
    expect(adapter.send.mock.calls[0][0].body).toBeInstanceOf(ReadableStream);
  });

  it('reports upload progress for FormData bodies', async () => {
    const adapter = new MockAdapter();
    adapter.send.mockImplementation(async (request) => {
      if (request.body instanceof ReadableStream) {
        const reader = request.body.getReader();
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
      }
      return mockResponse({ ok: true });
    });

    const form = new FormData();
    form.append('file', new Blob(['abc']), 'a.txt');

    const uploads: ProgressEvent[] = [];
    const client = new QHttp({ adapter })
      .setBaseUrl('https://api.example.com')
      .setBody(form)
      .onProgress((e) => {
        if (e.direction === 'upload') uploads.push(e);
      });

    await client.post('/x');
    expect(uploads.length).toBeGreaterThan(0);
    expect(adapter.send.mock.calls[0][0].headers['content-type']).toMatch(/^multipart\/form-data;/);
  });

  it('reset clears fetch status manager state', async () => {
    const adapter = new MockAdapter();
    const client = new QHttp({ adapter }).setBaseUrl('https://api.example.com');
    await client.get('/x');
    client.reset();
    expect(client.fetchStatus).toBe('idle');
  });

  it('static deleteCacheByPrefix uses default engine', async () => {
    const cache = new MemoryCacheEngine();
    configureDefaultCacheEngine(cache);
    await cache.set('orders:1', 1);
    await cache.set('orders:2', 2);
    await QHttp.deleteCacheByPrefix('orders:');
    expect(await cache.get('orders:1')).toBeUndefined();
  });

  it('throws MISSING_URL_MACRO for unresolved template', async () => {
    const adapter = new MockAdapter();
    const client = new QHttp({ adapter })
      .setBaseUrl('https://api.example.com')
      .setUrl('/users/{{userId}}');

    await expect(client.get()).rejects.toMatchObject({ code: 'MISSING_URL_MACRO' });
  });

  it('retries GET on failure', async () => {
    const adapter = new MockAdapter();
    let calls = 0;
    adapter.send.mockImplementation(async () => {
      calls += 1;
      if (calls < 2) {
        return mockResponse({ err: true }, { ok: false, status: 503 });
      }
      return mockResponse({ ok: true });
    });

    const client = new QHttp({ adapter })
      .setBaseUrl('https://api.example.com')
      .setRetry({ retries: 2, retryDelay: 1, backoff: 'fixed' });

    const result = await client.get('/x');
    expect(result.data).toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it('uses function cacheKey override', async () => {
    const adapter = new MockAdapter();
    const cache = new MemoryCacheEngine();
    const client = new QHttp({ adapter })
      .setBaseUrl('https://api.example.com')
      .cache()
      .cacheEngine(cache)
      .cacheKey((ctx) => `custom:${ctx.macros.userId}`)
      .replaceUrlMacros({ userId: 'u9' });

    await client.get('/orders');
    await client.get('/orders');
    expect(adapter.send).toHaveBeenCalledOnce();
  });
});
