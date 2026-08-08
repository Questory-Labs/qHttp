import { BrowserWSAdapter } from './browser-ws-adapter.js';
import type {
  WSCloseEvent,
  WSMessageEvent,
  WSReadyState,
} from './ws-adapter.interface.js';
import { WS_OPEN } from './ws-adapter.interface.js';
import type { WSAdapter, WSAdapterSocket } from './ws-adapter.interface.js';
import { sleep } from '../utils/abortable.js';

export interface ReconnectOptions {
  retries?: number;
  delay?: number;
  backoff?: 'fixed' | 'exponential';
  maxDelay?: number;
}

export interface HeartbeatOptions {
  intervalMs: number;
  message?: string | ArrayBuffer;
  pongTimeoutMs?: number;
}

type EventMap = {
  open: () => void;
  message: (event: WSMessageEvent) => void;
  error: (error: Error) => void;
  close: (event: WSCloseEvent) => void;
  reconnect: (attempt: number) => void;
};

export class QWebSocket {
  readonly #url: string;
  #protocols?: string | string[];
  #headers: Record<string, string> = {};
  #adapter: WSAdapter = new BrowserWSAdapter();
  #socket?: WSAdapterSocket;
  #listeners: { [K in keyof EventMap]: Set<EventMap[K]> } = {
    open: new Set(),
    message: new Set(),
    error: new Set(),
    close: new Set(),
    reconnect: new Set(),
  };
  #sendQueue: Array<string | ArrayBuffer | Blob> = [];
  readonly #queueLimit: number;
  #reconnect?: ReconnectOptions;
  #heartbeat?: HeartbeatOptions;
  #heartbeatTimer?: ReturnType<typeof setInterval>;
  #pongTimer?: ReturnType<typeof setTimeout>;
  #reconnectAttempts = 0;
  #manualClose = false;
  #state: WSReadyState = 'closed';

  constructor(url: string, options: { queueLimit?: number } = {}) {
    this.#url = url;
    this.#queueLimit = options.queueLimit ?? 100;
  }

  setProtocols(protocols: string | string[]): this {
    this.#protocols = protocols;
    return this;
  }

  setHeaders(headers: Record<string, string>): this {
    this.#headers = { ...this.#headers, ...headers };
    return this;
  }

  setAdapter(adapter: WSAdapter): this {
    this.#adapter = adapter;
    return this;
  }

  setReconnect(options: ReconnectOptions): this {
    this.#reconnect = options;
    return this;
  }

  setHeartbeat(options: HeartbeatOptions): this {
    this.#heartbeat = options;
    return this;
  }

  onOpen(fn: EventMap['open']): this {
    this.#listeners.open.add(fn);
    return this;
  }

  onMessage(fn: EventMap['message']): this {
    this.#listeners.message.add(fn);
    return this;
  }

  onError(fn: EventMap['error']): this {
    this.#listeners.error.add(fn);
    return this;
  }

  onClose(fn: EventMap['close']): this {
    this.#listeners.close.add(fn);
    return this;
  }

  onReconnect(fn: EventMap['reconnect']): this {
    this.#listeners.reconnect.add(fn);
    return this;
  }

  off<K extends keyof EventMap>(event: K, fn: EventMap[K]): this {
    this.#listeners[event].delete(fn);
    return this;
  }

  get readyState(): WSReadyState {
    return this.#state;
  }

  connect(): this {
    this.#manualClose = false;
    this.#setState('connecting');
    this.#openSocket();
    return this;
  }

  send(data: string | ArrayBuffer | Blob): void {
    if (this.#socket && this.#socket.readyState === WS_OPEN) {
      this.#socket.send(data);
      return;
    }

    if (this.#sendQueue.length >= this.#queueLimit) {
      throw new Error('WebSocket send queue overflow');
    }

    this.#sendQueue.push(data);
  }

  sendJson(payload: unknown): void {
    this.send(JSON.stringify(payload));
  }

  close(code = 1000, reason = ''): void {
    this.#manualClose = true;
    this.#clearHeartbeat();
    this.#setState('closing');
    this.#socket?.close(code, reason);
    this.#setState('closed');
  }

  #openSocket(): void {
    this.#socket = this.#adapter.connect({
      url: this.#url,
      protocols: this.#protocols,
      headers: this.#headers,
    });

    const onOpen = () => {
      this.#reconnectAttempts = 0;
      this.#setState('open');
      this.#flushQueue();
      this.#startHeartbeat();
      for (const fn of this.#listeners.open) fn();
    };

    const onMessage = (event: WSMessageEvent) => {
      this.#resetPongTimer();
      for (const fn of this.#listeners.message) fn(event);
    };

    const onError = (event: Event) => {
      const error = event instanceof ErrorEvent ? new Error(event.message) : new Error('WebSocket error');
      for (const fn of this.#listeners.error) fn(error);
    };

    const onClose = (event: CloseEvent) => {
      this.#clearHeartbeat();
      const closeEvent: WSCloseEvent = {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
      };
      this.#setState('closed');
      for (const fn of this.#listeners.close) fn(closeEvent);

      if (!this.#manualClose && this.#shouldReconnect(event.code)) {
        void this.#scheduleReconnect();
      }
    };

    this.#socket.addEventListener('open', onOpen as (event: unknown) => void);
    this.#socket.addEventListener('message', onMessage as (event: unknown) => void);
    this.#socket.addEventListener('error', onError as (event: unknown) => void);
    this.#socket.addEventListener('close', onClose as (event: unknown) => void);
  }

  #flushQueue(): void {
    while (this.#sendQueue.length > 0 && this.#socket?.readyState === WS_OPEN) {
      const item = this.#sendQueue.shift();
      if (item !== undefined) {
        this.#socket.send(item);
      }
    }
  }

  #shouldReconnect(code: number): boolean {
    if (!this.#reconnect) return false;
    if (code === 1000 || code === 1001) return false;
    const maxRetries = this.#reconnect.retries ?? 5;
    return this.#reconnectAttempts < maxRetries;
  }

  async #scheduleReconnect(): Promise<void> {
    const opts = this.#reconnect!;
    this.#reconnectAttempts += 1;
    this.#setState('reconnecting');
    for (const fn of this.#listeners.reconnect) fn(this.#reconnectAttempts);

    const base = opts.delay ?? 1000;
    const delay =
      opts.backoff === 'exponential'
        ? Math.min(base * 2 ** (this.#reconnectAttempts - 1), opts.maxDelay ?? 30_000)
        : base;

    await sleep(delay);
    if (!this.#manualClose) {
      this.#openSocket();
    }
  }

  #startHeartbeat(): void {
    if (!this.#heartbeat) return;

    this.#heartbeatTimer = setInterval(() => {
      if (this.#socket?.readyState === WS_OPEN) {
        const message = this.#heartbeat!.message ?? 'ping';
        this.#socket.send(message);
        this.#resetPongTimer();
      }
    }, this.#heartbeat.intervalMs);
  }

  #resetPongTimer(): void {
    if (!this.#heartbeat?.pongTimeoutMs) return;
    if (this.#pongTimer) clearTimeout(this.#pongTimer);
    this.#pongTimer = setTimeout(() => {
      this.#socket?.close(4000, 'Heartbeat timeout');
    }, this.#heartbeat!.pongTimeoutMs);
  }

  #clearHeartbeat(): void {
    if (this.#heartbeatTimer) clearInterval(this.#heartbeatTimer);
    if (this.#pongTimer) clearTimeout(this.#pongTimer);
    this.#heartbeatTimer = undefined;
    this.#pongTimer = undefined;
  }

  #setState(state: WSReadyState): void {
    this.#state = state;
  }
}
