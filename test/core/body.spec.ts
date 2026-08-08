import { describe, expect, it } from 'vitest';
import {
  isReplayableBody,
  parseResponseBody,
  serializeRequestBody,
  wrapBodyWithUploadProgress,
} from '../../src/core/body.js';
import type { ProgressEvent } from '../../src/core/types.js';
import { mergeHeaders } from '../../src/utils/headers.js';

describe('body serialization', () => {
  it('serializes objects as JSON with content-type', () => {
    const headers = new Map<string, string>();
    const result = serializeRequestBody('POST', { a: 1 }, headers);
    expect(result.body).toBe('{"a":1}');
    expect(headers.get('content-type')).toBe('application/json');
  });

  it('does not clobber explicit content-type', () => {
    const headers = mergeHeaders(undefined, { 'content-type': 'application/vnd.api+json' });
    serializeRequestBody('POST', { a: 1 }, headers);
    expect(headers.get('content-type')).toBe('application/vnd.api+json');
  });

  it('passes FormData through without content-type', () => {
    const headers = new Map<string, string>();
    const form = new FormData();
    const result = serializeRequestBody('POST', form, headers);
    expect(result.body).toBe(form);
    expect(headers.has('content-type')).toBe(false);
  });

  it('detects non-replayable stream bodies', () => {
    const stream = new ReadableStream();
    expect(isReplayableBody(stream)).toBe(false);
    expect(isReplayableBody('text')).toBe(true);
  });
});

describe('upload progress wrapping', () => {
  async function drain(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out;
  }

  it('wraps string bodies and reports upload progress', async () => {
    const headers = new Map<string, string>();
    const events: ProgressEvent[] = [];
    const payload = 'x'.repeat(100_000);
    const wrapped = wrapBodyWithUploadProgress(payload, headers, (e) => events.push(e));

    expect(wrapped?.duplex).toBe('half');
    expect(headers.get('content-length')).toBe(String(new TextEncoder().encode(payload).byteLength));
    expect(wrapped?.body).toBeInstanceOf(ReadableStream);

    const bytes = await drain(wrapped!.body as ReadableStream<Uint8Array>);
    expect(new TextDecoder().decode(bytes)).toBe(payload);
    expect(events.length).toBeGreaterThan(1);
    expect(events.every((e) => e.direction === 'upload')).toBe(true);
    expect(events.at(-1)).toMatchObject({
      loaded: bytes.byteLength,
      total: bytes.byteLength,
      direction: 'upload',
    });
  });

  it('wraps ArrayBuffer views', async () => {
    const headers = new Map<string, string>();
    const events: ProgressEvent[] = [];
    const view = new Uint8Array([1, 2, 3, 4, 5]);
    const wrapped = wrapBodyWithUploadProgress(view, headers, (e) => events.push(e));
    const bytes = await drain(wrapped!.body as ReadableStream<Uint8Array>);
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4, 5]);
    expect(events.at(-1)?.loaded).toBe(5);
  });

  it('wraps Blobs via their stream', async () => {
    const headers = new Map<string, string>();
    const events: ProgressEvent[] = [];
    const blob = new Blob(['hello'], { type: 'text/plain' });
    const wrapped = wrapBodyWithUploadProgress(blob, headers, (e) => events.push(e));

    expect(headers.get('content-type')).toBe('text/plain');
    expect(headers.get('content-length')).toBe('5');
    const bytes = await drain(wrapped!.body as ReadableStream<Uint8Array>);
    expect(new TextDecoder().decode(bytes)).toBe('hello');
    expect(events.at(-1)).toMatchObject({ loaded: 5, total: 5, direction: 'upload' });
  });

  it('wraps FormData via Request body stream', async () => {
    const headers = new Map<string, string>();
    const events: ProgressEvent[] = [];
    const form = new FormData();
    form.append('name', 'questory');
    form.append('file', new Blob(['payload']), 'a.txt');

    const wrapped = wrapBodyWithUploadProgress(form, headers, (e) => events.push(e));
    expect(wrapped?.duplex).toBe('half');
    expect(wrapped?.body).toBeInstanceOf(ReadableStream);
    expect(headers.get('content-type')).toMatch(/^multipart\/form-data;/);
    expect(headers.has('content-length')).toBe(false);

    const bytes = await drain(wrapped!.body as ReadableStream<Uint8Array>);
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.direction === 'upload')).toBe(true);
    expect(events.at(-1)?.loaded).toBe(bytes.byteLength);
    expect(events.at(-1)?.total).toBeTypeOf('number');
  });

  it('wraps opaque streams and uses Content-Length as total', async () => {
    const headers = new Map<string, string>([['content-length', '5']]);
    const events: ProgressEvent[] = [];
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('hello'));
        controller.close();
      },
    });

    const wrapped = wrapBodyWithUploadProgress(source, headers, (e) => events.push(e));
    const bytes = await drain(wrapped!.body as ReadableStream<Uint8Array>);
    expect(new TextDecoder().decode(bytes)).toBe('hello');
    expect(events.at(-1)).toMatchObject({ loaded: 5, total: 5, direction: 'upload' });
  });

  it('wraps opaque streams without total when Content-Length is absent', async () => {
    const headers = new Map<string, string>();
    const events: ProgressEvent[] = [];
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    });

    const wrapped = wrapBodyWithUploadProgress(source, headers, (e) => events.push(e));
    await drain(wrapped!.body as ReadableStream<Uint8Array>);
    expect(events.at(-1)).toMatchObject({ loaded: 3, direction: 'upload' });
    expect(events.at(-1)?.total).toBeUndefined();
  });
});

describe('response parsing', () => {
  it('auto parses json', async () => {
    const response = {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      body: null,
      arrayBuffer: async () => new ArrayBuffer(0),
      json: async () => ({ ok: true }),
      text: async () => '{"ok":true}',
      blob: async () => new Blob(),
    };
    const data = await parseResponseBody(response, 'auto');
    expect(data).toEqual({ ok: true });
  });

  it('reads content-type via duck-typed Headers.get', async () => {
    const headers = {
      get: (name: string) => (name === 'content-type' ? 'application/json' : null),
    };
    const response = {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers,
      body: null,
      arrayBuffer: async () => new ArrayBuffer(0),
      json: async () => ({ ok: true }),
      text: async () => '{"ok":true}',
      blob: async () => new Blob(),
    };
    const data = await parseResponseBody(response, 'auto');
    expect(data).toEqual({ ok: true });
  });

  it('parses text response type', async () => {
    const response = {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'text/plain' },
      body: null,
      arrayBuffer: async () => new ArrayBuffer(0),
      json: async () => ({}),
      text: async () => 'hello',
      blob: async () => new Blob(),
    };
    const data = await parseResponseBody(response, 'text');
    expect(data).toBe('hello');
  });

  it('throws onProgress incompatible with stream', async () => {
    const { assertProgressCompatible } = await import('../../src/core/body.js');
    expect(() => assertProgressCompatible('stream', true)).toThrow();
  });
});
