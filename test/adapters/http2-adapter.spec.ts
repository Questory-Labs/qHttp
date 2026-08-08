import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { QHttpError } from '../../src/errors/qhttp-error.js';
import { serializeHttp2Body } from '../../src/adapters/http2-adapter.js';

class FakeRequest extends EventEmitter {
  encoding?: string;
  ended?: Buffer | string;

  setEncoding(encoding: string) {
    this.encoding = encoding;
  }

  end(body?: Buffer | string) {
    this.ended = body;
    queueMicrotask(() => {
      this.emit('response', { ':status': '200', 'content-type': 'application/octet-stream' });
      const payload = Buffer.from([0xff, 0x00, 0xfe]);
      this.emit('data', payload);
      this.emit('end');
    });
  }
}

class FakeSession extends EventEmitter {
  destroyed = false;
  closed = false;
  requests: FakeRequest[] = [];

  request(_headers: Record<string, string>) {
    const req = new FakeRequest();
    this.requests.push(req);
    return req;
  }

  unref() {}

  close() {
    this.closed = true;
    this.emit('close');
  }
}

describe('serializeHttp2Body', () => {
  it('serializes string, buffer, array buffer, and views', async () => {
    expect(await serializeHttp2Body('hello')).toBe('hello');
    expect(await serializeHttp2Body(Buffer.from('bin'))).toEqual(Buffer.from('bin'));

    const ab = new Uint8Array([1, 2, 3]).buffer;
    expect(await serializeHttp2Body(ab)).toEqual(Buffer.from([1, 2, 3]));

    const view = new Uint8Array([4, 5]);
    expect(await serializeHttp2Body(view)).toEqual(Buffer.from([4, 5]));
  });

  it('serializes URLSearchParams and Blob', async () => {
    expect(await serializeHttp2Body(new URLSearchParams({ a: '1' }))).toBe('a=1');
    expect(await serializeHttp2Body(new Blob([new Uint8Array([9, 8])]))).toEqual(
      Buffer.from([9, 8]),
    );
  });

  it('rejects FormData and ReadableStream', async () => {
    await expect(serializeHttp2Body(new FormData())).rejects.toBeInstanceOf(QHttpError);
    await expect(
      serializeHttp2Body(new ReadableStream({ start(c) { c.close(); } })),
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
  });
});

describe('Http2Adapter', () => {
  afterEach(() => {
    vi.doUnmock('node:http2');
    vi.resetModules();
  });

  it('preserves binary response bytes without setEncoding', async () => {
    const session = new FakeSession();
    vi.resetModules();
    vi.doMock('node:http2', () => ({
      connect: () => session,
    }));

    const { Http2Adapter } = await import('../../src/adapters/http2-adapter.js');
    const adapter = new Http2Adapter();
    const response = await adapter.send({
      url: 'https://example.com/bin',
      method: 'GET',
      headers: {},
    });

    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes]).toEqual([0xff, 0x00, 0xfe]);
    expect(session.requests[0]?.encoding).toBeUndefined();
    adapter.close();
  });

  it('sends buffer bodies and rejects unsupported FormData', async () => {
    const session = new FakeSession();
    vi.resetModules();
    vi.doMock('node:http2', () => ({
      connect: () => session,
    }));

    const { Http2Adapter } = await import('../../src/adapters/http2-adapter.js');
    const adapter = new Http2Adapter();

    await adapter.send({
      url: 'https://example.com/post',
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: new Uint8Array([1, 2, 3]),
    });
    expect(session.requests[0]?.ended).toEqual(Buffer.from([1, 2, 3]));

    await expect(
      adapter.send({
        url: 'https://example.com/post',
        method: 'POST',
        headers: {},
        body: new FormData(),
      }),
    ).rejects.toMatchObject({ name: 'QHttpError', code: 'INVALID_CONFIG' });

    adapter.close();
  });

  it('evicts sessions on close/error/goaway', async () => {
    const sessions: FakeSession[] = [];
    vi.resetModules();
    vi.doMock('node:http2', () => ({
      connect: () => {
        const session = new FakeSession();
        sessions.push(session);
        return session;
      },
    }));

    const { Http2Adapter } = await import('../../src/adapters/http2-adapter.js');
    const adapter = new Http2Adapter();

    await adapter.send({
      url: 'https://example.com/a',
      method: 'GET',
      headers: {},
    });
    expect(sessions).toHaveLength(1);

    sessions[0]!.emit('goaway');

    await adapter.send({
      url: 'https://example.com/a',
      method: 'GET',
      headers: {},
    });
    expect(sessions).toHaveLength(2);

    adapter.close();
  });
});
