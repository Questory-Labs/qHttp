import { describe, expect, it } from 'vitest';
import { QHttp } from '../../src/core/QHttp.js';
import { filterHttp2Headers } from '../../src/adapters/http2-adapter.js';
import { SpyAdapter, mockResponse } from '../helpers.js';

async function drainBody(body: unknown): Promise<string> {
  if (body instanceof ReadableStream) return new Response(body).text();
  return String(body);
}

describe('FormData upload retry', () => {
  it('re-serializes the boundary on every attempt so header and body agree', async () => {
    const adapter = new SpyAdapter();
    const seen: Array<{ header: string; body: string }> = [];
    let calls = 0;
    adapter.send.mockImplementation(async (request) => {
      const req = request as { headers: Record<string, string>; body: unknown };
      seen.push({ header: req.headers['content-type']!, body: await drainBody(req.body) });
      calls += 1;
      return calls === 1 ? mockResponse({}, { status: 503 }) : mockResponse({ ok: true });
    });

    const form = new FormData();
    form.append('file', new Blob(['abc']), 'a.txt');
    const client = new QHttp({ adapter })
      .setRetry({ retries: 1, retryDelay: 1, retryOn: () => true })
      .onProgress(() => {});

    await client.post('https://api.example.com/upload', { body: form });
    expect(seen).toHaveLength(2);
    for (const { header, body } of seen) {
      const boundary = /boundary=(.+)$/.exec(header)?.[1];
      expect(boundary).toBeTruthy();
      expect(body).toContain(boundary!);
    }
  });
});

describe('filterHttp2Headers', () => {
  it('drops connection-specific and pseudo headers', () => {
    expect(
      filterHttp2Headers({
        Connection: 'keep-alive',
        'Transfer-Encoding': 'chunked',
        Host: 'x',
        ':path': '/evil',
        TE: 'gzip',
        Accept: 'application/json',
      }),
    ).toEqual({ accept: 'application/json' });
    expect(filterHttp2Headers({ te: 'trailers' })).toEqual({ te: 'trailers' });
  });
});
