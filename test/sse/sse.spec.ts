import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSseParser, type SseMessage } from '../../src/sse/parser.js';
import { QEventSource, subscribeSse } from '../../src/sse/QEventSource.js';

function streamOf(chunks: string[], signal?: AbortSignal): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      if (!signal) controller.close();
      else signal.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')));
    },
  });
}

function sseResponse(chunks: string[], init: { status?: number; signal?: AbortSignal } = {}): Response {
  return new Response(streamOf(chunks, init.signal), {
    status: init.status ?? 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createSseParser', () => {
  it('parses events across chunk boundaries, comments, ids and retry', () => {
    const got: SseMessage[] = [];
    const parser = createSseParser((m) => got.push(m));
    parser.push(': comment\nevent: tick\nda');
    parser.push('ta: a\ndata: b\nid: 7\nretry: 250\n\r\n');
    parser.push('data: plain\n\n');
    parser.push('data: trailing');
    parser.end();

    expect(got).toEqual([
      { event: 'tick', data: 'a\nb', id: '7', retry: 250 },
      { event: 'message', data: 'plain', id: '7', retry: undefined },
    ]);
    expect(parser.lastEventId).toBe('7');
  });

  it('discards an unfinished frame at end without updating the resume id', () => {
    const got: SseMessage[] = [];
    const ids: string[] = [];
    const parser = createSseParser((m) => got.push(m), { onId: (id) => ids.push(id) });
    parser.push('id: 1\ndata: done\n\n');
    parser.push('id: 2\ndata: partial\n');
    parser.end();

    expect(got.map((m) => m.data)).toEqual(['done']);
    expect(ids).toEqual(['1']);
    expect(parser.lastEventId).toBe('1');
  });

  it('ignores events without data', () => {
    const got: SseMessage[] = [];
    const parser = createSseParser((m) => got.push(m));
    parser.push('event: only-name\n\n');
    expect(got).toEqual([]);
  });
});

describe('QEventSource', () => {
  it('dispatches named and json events, tracks lastEventId', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse(['id: 1\nevent: update\ndata: {"n":1}\n\n', 'data: {"n":2}\n\n']),
    );
    const source = new QEventSource('https://api.test/stream', {
      fetch: fetchMock as typeof fetch,
      reconnect: false,
      headers: { authorization: 'Bearer t' },
    });

    const all: string[] = [];
    const named: string[] = [];
    const json: number[] = [];
    source.onMessage((m) => all.push(m.data));
    source.onEvent('update', (m) => named.push(m.data));
    source.onJson<{ n: number }>((p) => json.push(p.n));
    const closed = new Promise<void>((resolve) => source.onClose(resolve));
    source.connect();
    await closed;

    expect(all).toEqual(['{"n":1}', '{"n":2}']);
    expect(named).toEqual(['{"n":1}']);
    expect(json).toEqual([1, 2]);
    expect(source.lastEventId).toBe('1');
    expect(source.readyState).toBe('closed');
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).accept).toBe('text/event-stream');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer t');
  });

  it('reconnects with Last-Event-ID after the stream ends', async () => {
    vi.useFakeTimers();
    // Second stream stays open so the (consecutive-failure) retry budget is not consumed again.
    const keepOpen = new AbortController();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sseResponse(['id: 9\ndata: first\n\n']))
      .mockResolvedValueOnce(sseResponse(['data: second\n\n'], { signal: keepOpen.signal }));
    const source = new QEventSource('https://api.test/stream', {
      fetch: fetchMock as typeof fetch,
      reconnect: { retries: 1, delay: 100, backoff: 'fixed' },
    });
    const data: string[] = [];
    const reconnects: number[] = [];
    source.onMessage((m) => data.push(m.data));
    source.onReconnect((n) => reconnects.push(n));
    source.connect();

    await vi.advanceTimersByTimeAsync(10);
    expect(data).toEqual(['first']);
    expect(source.readyState).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(10);
    expect(data).toEqual(['first', 'second']);
    expect(reconnects).toEqual([1]);
    expect(source.readyState).toBe('open');
    const secondInit = fetchMock.mock.calls[1]![1] as RequestInit;
    expect((secondInit.headers as Record<string, string>)['last-event-id']).toBe('9');
    source.close();
  });

  it('does not reconnect on 4xx and reports the error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([], { status: 403 }));
    const source = new QEventSource('https://api.test/stream', { fetch: fetchMock as typeof fetch });
    const errors: Error[] = [];
    source.onError((e) => errors.push(e));
    const closed = new Promise<void>((resolve) => source.onClose(resolve));
    source.connect();
    await closed;
    expect(errors[0]?.message).toContain('403');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('close() aborts the fetch and subscribeSse binds to a signal', async () => {
    const fetchMock = vi.fn((_: string, init: RequestInit) =>
      Promise.resolve(sseResponse(['data: a\n\n'], { signal: init.signal! })),
    );
    const ac = new AbortController();
    const data: string[] = [];
    const source = subscribeSse(
      'https://api.test/stream',
      { fetch: fetchMock as unknown as typeof fetch, onMessage: (m) => data.push(m.data) },
      ac.signal,
    );
    await vi.waitFor(() => expect(data).toEqual(['a']));
    expect(source.readyState).toBe('open');
    ac.abort();
    expect(source.readyState).toBe('closed');
    const init = fetchMock.mock.calls[0]![1];
    expect(init.signal?.aborted).toBe(true);
  });

  it('supports async iteration', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(['data: 1\n\n', 'data: 2\n\n']));
    const source = new QEventSource('https://api.test/stream', {
      fetch: fetchMock as typeof fetch,
      reconnect: false,
    });
    const seen: string[] = [];
    for await (const message of source) seen.push(message.data);
    expect(seen).toEqual(['1', '2']);
  });
});
