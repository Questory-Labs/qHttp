import { describe, expect, it, vi } from 'vitest';
import { QHttp } from '../../src/core/QHttp.js';
import { QHttpError } from '../../src/errors/qhttp-error.js';
import { SpyAdapter, mockResponse } from '../helpers.js';

describe('per-call request options', () => {
  it('overrides instance config without mutating it', async () => {
    const adapter = new SpyAdapter();
    const client = new QHttp({ adapter, baseUrl: 'https://api.example.com' })
      .setHeaders({ 'x-app': 'base' })
      .setQueryParams({ page: 1 });

    await client.get('/items', {
      params: { page: 2, tag: 'x' },
      headers: { 'x-app': 'call', 'x-extra': '1' },
    });
    await client.get('/items');

    const first = adapter.send.mock.calls[0]![0];
    const second = adapter.send.mock.calls[1]![0];
    expect(first.url).toBe('https://api.example.com/items?page=2&tag=x');
    expect(first.headers['x-app']).toBe('call');
    expect(first.headers['x-extra']).toBe('1');
    expect(second.url).toBe('https://api.example.com/items?page=1');
    expect(second.headers['x-app']).toBe('base');
    expect(second.headers['x-extra']).toBeUndefined();
  });

  it('accepts body, macros and method through request()', async () => {
    const adapter = new SpyAdapter();
    const client = new QHttp({ adapter, baseUrl: 'https://api.example.com' });

    await client.request({
      method: 'POST',
      url: '/users/{{id}}',
      macros: { id: 'u1' },
      body: { name: 'a' },
    });

    const req = adapter.send.mock.calls[0]![0];
    expect(req.method).toBe('POST');
    expect(req.url).toBe('https://api.example.com/users/u1');
    expect(req.body).toBe('{"name":"a"}');
    expect(req.headers['content-type']).toBe('application/json');
  });

  it('absolute URLs bypass baseUrl', async () => {
    const adapter = new SpyAdapter();
    const client = new QHttp({ adapter, baseUrl: 'https://api.example.com' });
    await client.get('https://other.example/x');
    expect(adapter.send.mock.calls[0]![0].url).toBe('https://other.example/x');
  });

  it('passes fetchOptions through to the adapter', async () => {
    const adapter = new SpyAdapter();
    const client = new QHttp({ adapter }).setFetchOptions({ credentials: 'include' });
    await client.get('https://api.example.com/x', { fetchOptions: { cache: 'no-store' } });
    expect(adapter.send.mock.calls[0]![0].init).toEqual({
      credentials: 'include',
      cache: 'no-store',
    });
  });

  it('serves concurrent calls on one instance independently', async () => {
    const adapter = new SpyAdapter();
    adapter.send.mockImplementation(async (request) =>
      mockResponse({ url: (request as { url: string }).url }),
    );
    const client = new QHttp({ adapter, baseUrl: 'https://api.example.com' });

    const [a, b] = await Promise.all([client.get<{ url: string }>('/a'), client.get<{ url: string }>('/b')]);
    expect(a.data.url).toContain('/a');
    expect(b.data.url).toContain('/b');
    expect(a.requestId).not.toBe(b.requestId);
    expect(client.inFlight).toBe(0);
  });

  it('throwOnError:false keeps parsed body and headers of the failed response', async () => {
    const adapter = new SpyAdapter();
    adapter.send.mockResolvedValue(
      mockResponse({ message: 'nope' }, { status: 404, headers: { 'x-trace': 't1' } }),
    );
    const client = new QHttp({ adapter, throwOnError: false });

    const result = await client.get('https://api.example.com/missing');
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(404);
    expect(result.data).toEqual({ message: 'nope' });
    expect(result.headers['x-trace']).toBe('t1');
    expect(result.error?.code).toBe('HTTP_ERROR');
    expect(result.error?.data).toEqual({ message: 'nope' });
    expect(result.timing.attempts).toBe(1);
  });

  it('exposes the native Response and timing on results', async () => {
    const native = new Response('{"ok":true}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(native));
    const client = new QHttp();
    const result = await client.get('https://api.example.com/x');
    expect(result.response).toBe(native);
    expect(result.timing.durationMs).toBeGreaterThanOrEqual(0);
    expect(typeof result.requestId).toBe('string');
    vi.unstubAllGlobals();
  });

  it('redacts credentials from errors', async () => {
    const adapter = new SpyAdapter();
    adapter.send.mockRejectedValue(new Error('boom'));
    const client = new QHttp({ adapter })
      .setAuth({ type: 'bearer', token: 'secret-token' })
      .setBody({ password: 'hunter2' });

    const err = await client.post('https://api.example.com/login').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(QHttpError);
    const serialized = JSON.stringify(err);
    expect(serialized).not.toContain('secret-token');
    expect(serialized).not.toContain('hunter2');
    expect((err as QHttpError).request?.headers?.authorization).toBe('[redacted]');
    expect((err as QHttpError).requestId).toBeTruthy();
  });

  it('deadline bounds the whole request including retries', async () => {
    vi.useFakeTimers();
    const adapter = new SpyAdapter();
    adapter.send.mockImplementation(
      () =>
        new Promise((_, reject) => {
          setTimeout(() => reject(new TypeError('fail')), 100);
        }),
    );
    const client = new QHttp({ adapter })
      .setRetry({ retries: 10, retryDelay: 100, backoff: 'fixed' })
      .setDeadline(450);

    const pending = client.get('https://api.example.com/x').catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1_000);
    const err = (await pending) as QHttpError;
    expect(err.code).toBe('DEADLINE');
    expect(adapter.send.mock.calls.length).toBeLessThanOrEqual(3);
    vi.useRealTimers();
  });

  it('per-attempt timeout maps to TIMEOUT', async () => {
    vi.useFakeTimers();
    const adapter = new SpyAdapter();
    adapter.send.mockImplementation(
      (request) =>
        new Promise((_, reject) => {
          (request as { signal?: AbortSignal }).signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    const client = new QHttp({ adapter }).setTimeout(50);
    const pending = client.get('https://api.example.com/x').catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(60);
    expect(((await pending) as QHttpError).code).toBe('TIMEOUT');
    vi.useRealTimers();
  });

  it('empty JSON bodies parse to undefined instead of throwing', async () => {
    const adapter = new SpyAdapter();
    adapter.send.mockResolvedValue(
      mockResponse('', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const client = new QHttp({ adapter });
    const result = await client.get('https://api.example.com/x');
    expect(result.data).toBeUndefined();
  });

  it('sniffs xml and svg as text', async () => {
    const adapter = new SpyAdapter();
    adapter.send.mockResolvedValue(
      mockResponse('<a/>', { headers: { 'content-type': 'application/xml' } }),
    );
    const client = new QHttp({ adapter });
    const result = await client.get('https://api.example.com/x');
    expect(result.data).toBe('<a/>');
  });
});
