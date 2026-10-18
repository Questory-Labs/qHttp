import { afterEach, describe, expect, it, vi } from 'vitest';
import { QWebSocket } from '../../src/ws/QWebSocket.js';
import type { WSAdapter } from '../../src/ws/ws-adapter.interface.js';

class MockSocket {
  readyState = 0;
  listeners: Record<string, Array<(event: unknown) => void>> = {};
  sent: unknown[] = [];
  bufferedAmount = 0;

  addEventListener(type: string, listener: (event: unknown) => void) {
    (this.listeners[type] ??= []).push(listener);
  }

  removeEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((l) => l !== listener);
  }

  send(data: unknown) {
    this.sent.push(data);
  }

  close(code?: number, reason?: string) {
    this.readyState = 3;
    for (const fn of [...(this.listeners.close ?? [])]) {
      fn({ code: code ?? 1006, reason: reason ?? '', wasClean: false });
    }
  }

  emit(type: string, event: unknown = {}) {
    for (const fn of [...(this.listeners[type] ?? [])]) fn(event);
  }

  listenerCount() {
    return Object.values(this.listeners).reduce((n, l) => n + l.length, 0);
  }
}

class MockWSAdapter implements WSAdapter {
  sockets: MockSocket[] = [];
  connect() {
    const socket = new MockSocket();
    this.sockets.push(socket);
    return socket;
  }
  get latest() {
    return this.sockets[this.sockets.length - 1]!;
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('QWebSocket lifecycle', () => {
  it('detaches listeners from replaced sockets and ignores their late events', async () => {
    vi.useFakeTimers();
    const adapter = new MockWSAdapter();
    const closes: number[] = [];
    const ws = new QWebSocket('wss://x')
      .setAdapter(adapter)
      .setReconnect({ retries: 3, delay: 10, backoff: 'fixed' })
      .onClose((e) => closes.push(e.code))
      .connect();

    const first = adapter.latest;
    first.readyState = 1;
    first.emit('open');
    first.close(1006);
    expect(first.listenerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(10);
    expect(adapter.sockets).toHaveLength(2);
    first.emit('close', { code: 1006, reason: 'late', wasClean: false });
    await vi.advanceTimersByTimeAsync(50);
    expect(adapter.sockets).toHaveLength(2);
    expect(closes).toEqual([1006]);
    // Stays 'reconnecting' until the replacement socket opens.
    expect(ws.readyState).toBe('reconnecting');
  });

  it('close() then connect() does not double-connect', async () => {
    vi.useFakeTimers();
    const adapter = new MockWSAdapter();
    const ws = new QWebSocket('wss://x').setAdapter(adapter).setReconnect({ retries: 3, delay: 10 });
    ws.connect();
    adapter.latest.readyState = 1;
    adapter.latest.emit('open');
    ws.close();
    ws.connect();
    await vi.advanceTimersByTimeAsync(100);
    expect(adapter.sockets).toHaveLength(2);
  });

  it('connect() while open is a no-op', () => {
    const adapter = new MockWSAdapter();
    const ws = new QWebSocket('wss://x').setAdapter(adapter).connect();
    adapter.latest.readyState = 1;
    adapter.latest.emit('open');
    ws.connect();
    expect(adapter.sockets).toHaveLength(1);
  });

  it('emits reconnected and state events, exposes bufferedAmount and queue', async () => {
    vi.useFakeTimers();
    const adapter = new MockWSAdapter();
    const states: string[] = [];
    const reconnected: number[] = [];
    const ws = new QWebSocket('wss://x')
      .setAdapter(adapter)
      .setReconnect({ retries: 3, delay: 10, jitter: true })
      .onStateChange((s) => states.push(s))
      .onReconnected((n) => reconnected.push(n))
      .connect();

    ws.send('queued');
    expect(ws.queuedCount).toBe(1);
    adapter.latest.readyState = 1;
    adapter.latest.emit('open');
    expect(ws.queuedCount).toBe(0);
    adapter.latest.bufferedAmount = 42;
    expect(ws.bufferedAmount).toBe(42);

    adapter.latest.close(1006);
    await vi.advanceTimersByTimeAsync(20);
    adapter.latest.readyState = 1;
    adapter.latest.emit('open');
    expect(reconnected).toEqual([1]);
    expect(states).toEqual(['connecting', 'open', 'closed', 'reconnecting', 'open']);
  });

  it('onJson parses text frames and isPong gates the heartbeat', async () => {
    vi.useFakeTimers();
    const adapter = new MockWSAdapter();
    const payloads: unknown[] = [];
    new QWebSocket('wss://x')
      .setAdapter(adapter)
      .setHeartbeat({ intervalMs: 100, pongTimeoutMs: 50, isPong: 'pong' })
      .onJson((p) => payloads.push(p))
      .connect();
    adapter.latest.readyState = 1;
    adapter.latest.emit('open');

    adapter.latest.emit('message', { data: '{"a":1}' });
    adapter.latest.emit('message', { data: 'not json' });
    expect(payloads).toEqual([{ a: 1 }]);

    await vi.advanceTimersByTimeAsync(100);
    adapter.latest.emit('message', { data: 'chatter' });
    await vi.advanceTimersByTimeAsync(50);
    expect(adapter.latest.readyState).toBe(3);
  });

  it('returns to closed when the adapter throws on connect, so connect() can be called again', () => {
    const adapter = new MockWSAdapter();
    const failure = new Error('blocked');
    let fail = true;
    const throwing: WSAdapter = {
      connect: () => {
        if (fail) throw failure;
        return adapter.connect();
      },
    };
    const ws = new QWebSocket('wss://x').setAdapter(throwing);

    expect(() => ws.connect()).toThrow(failure);
    expect(ws.readyState).toBe('closed');

    fail = false;
    ws.connect();
    expect(ws.readyState).toBe('connecting');
    expect(adapter.sockets).toHaveLength(1);
  });
});
