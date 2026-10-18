import { BrowserWSAdapter } from './browser-ws-adapter.js';
import type { WSCloseEvent, WSMessageEvent, WSReadyState } from './ws-adapter.interface.js';
import { WS_OPEN } from './ws-adapter.interface.js';
import type { WSAdapter, WSAdapterSocket } from './ws-adapter.interface.js';
import { sleep } from '../utils/abortable.js';

export interface ReconnectOptions {
  retries?: number;
  delay?: number;
  backoff?: 'fixed' | 'exponential';
  maxDelay?: number;
  /** Randomize delay between 50% and 100% of the computed value. */
  jitter?: boolean;
  resetOn?: 'open' | ((event: WSMessageEvent) => boolean);
  reconnectOn?: (code: number) => boolean;
}

export interface HeartbeatOptions {
  intervalMs: number;
  message?: string | ArrayBuffer;
  pongTimeoutMs?: number;
  /**
   * Which incoming frames count as a pong. Default: any frame.
   * Pass a string to match an exact text frame, or a predicate.
   */
  isPong?: string | ((data: WSMessageEvent['data']) => boolean);
}

type EventMap = {
  open: () => void;
  message: (event: WSMessageEvent) => void;
  error: (error: Error) => void;
  close: (event: WSCloseEvent) => void;
  reconnect: (attempt: number) => void;
  /** Fired when a connection is re-established after a reconnect. */
  reconnected: (attempt: number) => void;
  state: (state: WSReadyState) => void;
};

type ListenerSets = { [K in keyof EventMap]: Set<EventMap[K]> };

type Bound = {
  socket: WSAdapterSocket;
  handlers: Array<['open' | 'message' | 'error' | 'close', (event: unknown) => void]>;
};

export class QWebSocket {
  readonly #url: string;
  #protocols?: string | string[];
  #headers: Record<string, string> = {};
  #adapter: WSAdapter = new BrowserWSAdapter();
  #bound?: Bound;
  #listeners: ListenerSets = {
    open: new Set(),
    message: new Set(),
    error: new Set(),
    close: new Set(),
    reconnect: new Set(),
    reconnected: new Set(),
    state: new Set(),
  };
  #sendQueue: Array<string | ArrayBuffer | Blob> = [];
  readonly #queueLimit: number;
  #reconnect?: ReconnectOptions;
  #heartbeat?: HeartbeatOptions;
  #heartbeatTimer?: ReturnType<typeof setInterval>;
  #pongTimer?: ReturnType<typeof setTimeout>;
  #reconnectAttempts = 0;
  #wasReconnecting = false;
  #manualClose = false;
  #awaitingReset = false;
  #state: WSReadyState = 'closed';
  #reconnectAbort?: AbortController;

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

  on<K extends keyof EventMap>(event: K, fn: EventMap[K]): this {
    this.#listeners[event].add(fn);
    return this;
  }

  onOpen(fn: EventMap['open']): this {
    return this.on('open', fn);
  }

  onMessage(fn: EventMap['message']): this {
    return this.on('message', fn);
  }

  /** Text frames parsed as JSON. Non-JSON frames are ignored. */
  onJson<T = unknown>(fn: (payload: T, event: WSMessageEvent) => void): this {
    const wrapped: EventMap['message'] = (event) => {
      if (typeof event.data !== 'string') return;
      let parsed: T;
      try {
        parsed = JSON.parse(event.data) as T;
      } catch {
        return;
      }
      fn(parsed, event);
    };
    return this.on('message', wrapped);
  }

  onError(fn: EventMap['error']): this {
    return this.on('error', fn);
  }

  onClose(fn: EventMap['close']): this {
    return this.on('close', fn);
  }

  onReconnect(fn: EventMap['reconnect']): this {
    return this.on('reconnect', fn);
  }

  onReconnected(fn: EventMap['reconnected']): this {
    return this.on('reconnected', fn);
  }

  onStateChange(fn: EventMap['state']): this {
    return this.on('state', fn);
  }

  off<K extends keyof EventMap>(event: K, fn: EventMap[K]): this {
    this.#listeners[event].delete(fn);
    return this;
  }

  get readyState(): WSReadyState {
    return this.#state;
  }

  /** Bytes queued on the underlying socket, when the adapter exposes it. */
  get bufferedAmount(): number {
    const socket = this.#bound?.socket as { bufferedAmount?: number } | undefined;
    return socket?.bufferedAmount ?? 0;
  }

  /** Messages waiting for the socket to open. */
  get queuedCount(): number {
    return this.#sendQueue.length;
  }

  connect(): this {
    if (this.#state === 'open' || this.#state === 'connecting') return this;
    if (this.#state === 'closed') {
      this.#reconnectAttempts = 0;
      this.#wasReconnecting = false;
    }
    this.#manualClose = false;
    this.#reconnectAbort?.abort();
    this.#setState('connecting');
    this.#openSocket();
    return this;
  }

  send(data: string | ArrayBuffer | Blob): void {
    const socket = this.#bound?.socket;
    if (socket && socket.readyState === WS_OPEN) {
      socket.send(data);
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
    this.#awaitingReset = false;
    this.#reconnectAbort?.abort();
    this.#clearHeartbeat();
    const bound = this.#bound;
    this.#unbind();
    this.#setState('closing');
    try {
      bound?.socket.close(code, reason);
    } catch {
      // ignore
    }
    this.#setState('closed');
  }

  #openSocket(): void {
    this.#unbind();
    const socket = this.#adapter.connect({
      url: this.#url,
      protocols: this.#protocols,
      headers: this.#headers,
    });

    const bound: Bound = { socket, handlers: [] };
    this.#bound = bound;
    const current = () => this.#bound === bound;

    const onOpen = () => {
      if (!current()) return;
      const deferred = typeof this.#reconnect?.resetOn === 'function';
      this.#awaitingReset = deferred;
      this.#setState('open');
      this.#flushQueue();
      this.#startHeartbeat();
      for (const fn of this.#listeners.open) fn();
      if (!deferred) this.#resetAttempts();
    };

    const onMessage = (event: WSMessageEvent) => {
      if (!current()) return;
      if (this.#isPong(event.data)) this.#resetPongTimer();
      const resetOn = this.#reconnect?.resetOn;
      if (this.#awaitingReset && typeof resetOn === 'function' && resetOn(event)) {
        this.#awaitingReset = false;
        this.#resetAttempts();
      }
      for (const fn of this.#listeners.message) fn(event);
    };

    const onError = (event: unknown) => {
      if (!current()) return;
      this.#emitError(event);
    };

    const onClose = (event: WSCloseEvent) => {
      if (!current()) return;
      this.#clearHeartbeat();
      this.#unbind();
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

    this.#bind(bound, 'open', onOpen as (event: unknown) => void);
    this.#bind(bound, 'message', onMessage as (event: unknown) => void);
    this.#bind(bound, 'error', onError);
    this.#bind(bound, 'close', onClose as (event: unknown) => void);
  }

  #resetAttempts(): void {
    const attempt = this.#reconnectAttempts;
    const reconnected = this.#wasReconnecting;
    this.#reconnectAttempts = 0;
    this.#wasReconnecting = false;
    if (reconnected) {
      for (const fn of this.#listeners.reconnected) fn(attempt);
    }
  }

  #emitError(event: unknown): void {
    const error =
      typeof ErrorEvent !== 'undefined' && event instanceof ErrorEvent
        ? new Error(event.message)
        : event instanceof Error
          ? event
          : new Error('WebSocket error');
    for (const fn of this.#listeners.error) fn(error);
  }

  #bind(bound: Bound, type: Bound['handlers'][number][0], handler: (event: unknown) => void): void {
    bound.socket.addEventListener(type, handler);
    bound.handlers.push([type, handler]);
  }

  #unbind(): void {
    const bound = this.#bound;
    if (!bound) return;
    for (const [type, handler] of bound.handlers) {
      try {
        bound.socket.removeEventListener(type, handler);
      } catch {
        // ignore
      }
    }
    bound.handlers = [];
    this.#bound = undefined;
  }

  #flushQueue(): void {
    const socket = this.#bound?.socket;
    while (this.#sendQueue.length > 0 && socket?.readyState === WS_OPEN) {
      const item = this.#sendQueue.shift();
      if (item !== undefined) {
        socket.send(item);
      }
    }
  }

  #shouldReconnect(code: number): boolean {
    if (!this.#reconnect) return false;
    const reconnectOn = this.#reconnect.reconnectOn ?? ((closed: number) => closed !== 1000 && closed !== 1001);
    if (!reconnectOn(code)) return false;
    const maxRetries = this.#reconnect.retries ?? 5;
    return this.#reconnectAttempts < maxRetries;
  }

  async #scheduleReconnect(): Promise<void> {
    const opts = this.#reconnect!;
    this.#reconnectAttempts += 1;
    this.#wasReconnecting = true;
    this.#setState('reconnecting');
    for (const fn of this.#listeners.reconnect) fn(this.#reconnectAttempts);

    const base = opts.delay ?? 1000;
    let delay =
      opts.backoff === 'exponential'
        ? Math.min(base * 2 ** (this.#reconnectAttempts - 1), opts.maxDelay ?? 30_000)
        : base;
    if (opts.jitter) delay = delay / 2 + Math.random() * (delay / 2);

    const abort = new AbortController();
    this.#reconnectAbort = abort;
    try {
      await sleep(delay, abort.signal);
    } catch {
      return;
    }
    if (this.#reconnectAbort === abort) this.#reconnectAbort = undefined;
    if (!this.#manualClose && this.#state === 'reconnecting') {
      try {
        this.#openSocket();
      } catch (error) {
        this.#emitError(error);
        if (this.#shouldReconnect(1006)) void this.#scheduleReconnect();
        else this.#setState('closed');
      }
    }
  }

  #isPong(data: WSMessageEvent['data']): boolean {
    const matcher = this.#heartbeat?.isPong;
    if (matcher === undefined) return true;
    if (typeof matcher === 'string') return data === matcher;
    return matcher(data);
  }

  #startHeartbeat(): void {
    if (!this.#heartbeat) return;
    this.#clearHeartbeat();

    this.#heartbeatTimer = setInterval(() => {
      const socket = this.#bound?.socket;
      if (socket?.readyState === WS_OPEN) {
        const message = this.#heartbeat!.message ?? 'ping';
        socket.send(message);
        this.#resetPongTimer();
      }
    }, this.#heartbeat.intervalMs);
  }

  #resetPongTimer(): void {
    if (!this.#heartbeat?.pongTimeoutMs) return;
    if (this.#pongTimer) clearTimeout(this.#pongTimer);
    this.#pongTimer = setTimeout(() => {
      this.#bound?.socket.close(4000, 'Heartbeat timeout');
    }, this.#heartbeat!.pongTimeoutMs);
  }

  #clearHeartbeat(): void {
    if (this.#heartbeatTimer) clearInterval(this.#heartbeatTimer);
    if (this.#pongTimer) clearTimeout(this.#pongTimer);
    this.#heartbeatTimer = undefined;
    this.#pongTimer = undefined;
  }

  #setState(state: WSReadyState): void {
    if (this.#state === state) return;
    this.#state = state;
    for (const fn of this.#listeners.state) fn(state);
  }
}
