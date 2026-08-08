import { describe, expect, it, vi } from 'vitest';
import { QHttp } from '../../src/core/QHttp.js';
import type { HttpAdapter, RawResponseLike } from '../../src/core/types.js';
import { QHttpError } from '../../src/errors/qhttp-error.js';

function mockResponse(body: unknown, init: Partial<RawResponseLike> = {}): RawResponseLike {
  const json = JSON.stringify(body);
  const encoder = new TextEncoder();
  const bytes = encoder.encode(json);
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    headers: init.headers ?? { 'content-type': 'application/json' },
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
  send = vi.fn(async (): Promise<RawResponseLike> => mockResponse({ ok: true }));
}

describe('QHttp request execution', () => {
  it('executes GET and parses JSON', async () => {
    const adapter = new MockAdapter();
    const client = new QHttp({ adapter })
      .setBaseUrl('https://api.example.com')
      .setUrl('/things');

    const result = await client.get<{ ok: boolean }>();
    expect(result.data).toEqual({ ok: true });
    expect(result.httpStatus).toBe(200);
    expect(result.fetchStatus).toBe('success');
    expect(adapter.send).toHaveBeenCalledOnce();
  });

  it('inline verb path does not persist in instance', async () => {
    const adapter = new MockAdapter();
    const client = new QHttp({ adapter, baseUrl: 'https://api.example.com' }).setUrl('/persistent');

    await client.get('/inline');
    await client.get();

    expect(adapter.send.mock.calls[0]?.[0].url).toContain('/inline');
    expect(adapter.send.mock.calls[1]?.[0].url).toContain('/persistent');
  });

  it('rejects non-2xx by default', async () => {
    const adapter = new MockAdapter();
    adapter.send.mockResolvedValue(mockResponse({ err: true }, { ok: false, status: 404 }));

    const client = new QHttp({ adapter }).setBaseUrl('https://api.example.com');
    await expect(client.get('/missing')).rejects.toMatchObject({ code: 'HTTP_ERROR', httpStatus: 404 });
  });

  it('tracks fetchStatus transitions', async () => {
    const adapter = new MockAdapter();
    const client = new QHttp({ adapter }).setBaseUrl('https://api.example.com');
    const states: string[] = [];
    client.onStateChange((status) => states.push(status));

    await client.get('/x');
    expect(states).toEqual(['loading', 'success']);
    expect(client.fetchStatus).toBe('success');
  });

  it('runs preRequest and postRequest hooks in order', async () => {
    const adapter = new MockAdapter();
    const order: string[] = [];
    const client = new QHttp({ adapter })
      .setBaseUrl('https://api.example.com')
      .preRequest(() => {
        order.push('pre1');
      })
      .preRequest(() => {
        order.push('pre2');
      })
      .postRequest(() => {
        order.push('post1');
      });

    await client.get('/x');
    expect(order).toEqual(['pre1', 'pre2', 'post1']);
  });

  it('applies bearer auth header', async () => {
    const adapter = new MockAdapter();
    const client = new QHttp({ adapter })
      .setBaseUrl('https://api.example.com')
      .setAuth({ type: 'bearer', token: 'abc' });

    await client.get('/secure');
    expect(adapter.send.mock.calls[0]?.[0].headers.authorization).toBe('Bearer abc');
  });

  it('GET with body throws BODY_NOT_ALLOWED at build time', async () => {
    const adapter = new MockAdapter();
    const client = new QHttp({ adapter }).setBaseUrl('https://api.example.com').setBody({ x: 1 });
    await expect(client.get()).rejects.toMatchObject({ code: 'BODY_NOT_ALLOWED' });
  });
});
