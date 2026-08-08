import { afterEach, describe, expect, it, vi } from 'vitest';
import { QWebSocket } from '../../src/ws/QWebSocket.js';
import type { WSAdapter } from '../../src/ws/ws-adapter.interface.js';

class MockSocket {
  readyState = 0;
  listeners: Record<string, Array<(event: unknown) => void>> = {};
  sent: unknown[] = [];
  closeCalls: Array<{ code?: number; reason?: string }> = [];

  addEventListener(type: string, listener: (event: unknown) => void) {
    (this.listeners[type] ??= []).push(listener);
  }

  removeEventListener() {}

  send(data: unknown) {
    this.sent.push(data);
  }

  close(code?: number, reason?: string) {
    this.closeCalls.push({ code, reason });
    this.readyState = 3;
    for (const fn of this.listeners.close ?? []) {
      fn({ code: code ?? 1006, reason: reason ?? '', wasClean: false });
    }
  }

  emit(type: string, event: unknown = {}) {
    for (const fn of this.listeners[type] ?? []) fn(event);
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

describe('QWebSocket', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('buffers sends before open and flushes on open', () => {
    const adapter = new MockWSAdapter();
    const ws = new QWebSocket('wss://example.com').setAdapter(adapter).connect();

    ws.send('hello');
    expect(adapter.latest.sent).toHaveLength(0);

    adapter.latest.readyState = 1;
    adapter.latest.emit('open');

    expect(adapter.latest.sent).toEqual(['hello']);
    expect(ws.readyState).toBe('open');
  });

  it('reconnects with exponential backoff after unclean close', async () => {
    vi.useFakeTimers();
    const adapter = new MockWSAdapter();
    const reconnectAttempts: number[] = [];
    const ws = new QWebSocket('wss://example.com')
      .setAdapter(adapter)
      .setReconnect({ retries: 3, delay: 1000, backoff: 'exponential' })
      .onReconnect((attempt) => reconnectAttempts.push(attempt))
      .connect();

    adapter.latest.readyState = 1;
    adapter.latest.emit('open');
    adapter.latest.close(1006, 'drop');

    expect(ws.readyState).toBe('reconnecting');
    expect(reconnectAttempts).toEqual([1]);

    await vi.advanceTimersByTimeAsync(1000);
    expect(adapter.sockets).toHaveLength(2);

    adapter.latest.close(1006, 'drop');
    expect(reconnectAttempts).toEqual([1, 2]);

    await vi.advanceTimersByTimeAsync(2000);
    expect(adapter.sockets).toHaveLength(3);
  });

  it('does not reconnect after manual close', async () => {
    vi.useFakeTimers();
    const adapter = new MockWSAdapter();
    const ws = new QWebSocket('wss://example.com')
      .setAdapter(adapter)
      .setReconnect({ retries: 5, delay: 100 })
      .connect();

    adapter.latest.readyState = 1;
    adapter.latest.emit('open');
    ws.close(1000, 'bye');

    await vi.advanceTimersByTimeAsync(500);
    expect(adapter.sockets).toHaveLength(1);
    expect(ws.readyState).toBe('closed');
  });

  it('does not reconnect on clean close codes 1000/1001', async () => {
    vi.useFakeTimers();
    const adapter = new MockWSAdapter();
    new QWebSocket('wss://example.com')
      .setAdapter(adapter)
      .setReconnect({ retries: 5, delay: 100 })
      .connect();

    adapter.latest.readyState = 1;
    adapter.latest.emit('open');
    adapter.latest.close(1000, 'normal');

    await vi.advanceTimersByTimeAsync(500);
    expect(adapter.sockets).toHaveLength(1);
  });

  it('closes socket when heartbeat pong times out', async () => {
    vi.useFakeTimers();
    const adapter = new MockWSAdapter();
    new QWebSocket('wss://example.com')
      .setAdapter(adapter)
      .setHeartbeat({ intervalMs: 1000, message: 'ping', pongTimeoutMs: 200 })
      .connect();

    adapter.latest.readyState = 1;
    adapter.latest.emit('open');

    await vi.advanceTimersByTimeAsync(1000);
    expect(adapter.latest.sent).toContain('ping');

    await vi.advanceTimersByTimeAsync(200);
    expect(adapter.latest.closeCalls).toContainEqual({
      code: 4000,
      reason: 'Heartbeat timeout',
    });
  });

  it('throws when send queue overflows', () => {
    const adapter = new MockWSAdapter();
    const ws = new QWebSocket('wss://example.com', { queueLimit: 2 })
      .setAdapter(adapter)
      .connect();

    ws.send('a');
    ws.send('b');
    expect(() => ws.send('c')).toThrow('WebSocket send queue overflow');
  });
});
