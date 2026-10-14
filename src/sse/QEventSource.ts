import type { FetchOptions } from '../core/types.js';
import { sleep } from '../utils/abortable.js';
import { createSseParser, type SseMessage } from './parser.js';

export type SseReadyState = 'connecting' | 'open' | 'closed' | 'reconnecting';

export interface SseReconnectOptions {
  retries?: number;
  delay?: number;
  backoff?: 'fixed' | 'exponential';
  maxDelay?: number;
  jitter?: boolean;
}

export interface QEventSourceOptions {
  headers?: Record<string, string>;
  /** Fetch init passthrough (`credentials`, `cache`, `dispatcher`...). */
  fetchOptions?: FetchOptions;
  /** `POST` with a body is allowed, unlike the browser EventSource. */
  method?: 'GET' | 'POST';
  body?: BodyInit | null;
  /** Reconnect policy after a dropped stream. Default: 5 retries, 1s exponential. `false` disables. */
  reconnect?: SseReconnectOptions | false;
  /** Resume point sent as `Last-Event-ID` on the first connection. */
  lastEventId?: string;
  fetch?: typeof fetch;
  /** Abort the source when this signal fires. */
  signal?: AbortSignal;
}

type EventMap = {
  open: () => void;
  message: (message: SseMessage) => void;
  error: (error: Error) => void;
  close: () => void;
  reconnect: (attempt: number) => void;
  state: (state: SseReadyState) => void;
};

type ListenerSets = { [K in keyof EventMap]: Set<EventMap[K]> };

export class SseHttpError extends Error {
  constructor(
    readonly status: number,
    readonly response: Response,
  ) {
    super(`SSE connection failed with status ${status}`);
    this.name = 'SseHttpError';
  }
}

/**
 * Fetch-based Server-Sent Events client: custom headers, credentials, POST,
 * reconnect with backoff and `Last-Event-ID`, async iteration.
 */
export class QEventSource implements AsyncIterable<SseMessage> {
  readonly #url: string;
  readonly #options: QEventSourceOptions;
  #listeners: ListenerSets = {
    open: new Set(),
    message: new Set(),
    error: new Set(),
    close: new Set(),
    reconnect: new Set(),
    state: new Set(),
  };
  #named = new Map<string, Set<(message: SseMessage) => void>>();
  #state: SseReadyState = 'closed';
  #abort?: AbortController;
  #attempts = 0;
  #lastEventId?: string;
  #serverRetry?: number;
  #closed = false;

  constructor(url: string, options: QEventSourceOptions = {}) {
    this.#url = url;
    this.#options = options;
    this.#lastEventId = options.lastEventId;
    options.signal?.addEventListener('abort', () => this.close(), { once: true });
  }

  get readyState(): SseReadyState {
    return this.#state;
  }

  get lastEventId(): string | undefined {
    return this.#lastEventId;
  }

  on<K extends keyof EventMap>(event: K, fn: EventMap[K]): this {
    this.#listeners[event].add(fn);
    return this;
  }

  off<K extends keyof EventMap>(event: K, fn: EventMap[K]): this {
    this.#listeners[event].delete(fn);
    return this;
  }

  onOpen(fn: EventMap['open']): this {
    return this.on('open', fn);
  }

  /** Every message regardless of its `event` name. */
  onMessage(fn: EventMap['message']): this {
    return this.on('message', fn);
  }

  /** Messages with a specific `event:` name. */
  onEvent(name: string, fn: (message: SseMessage) => void): this {
    let set = this.#named.get(name);
    if (!set) {
      set = new Set();
      this.#named.set(name, set);
    }
    set.add(fn);
    return this;
  }

  /** `data` parsed as JSON. Frames that fail to parse are skipped. */
  onJson<T = unknown>(fn: (payload: T, message: SseMessage) => void, event?: string): this {
    const handler = (message: SseMessage) => {
      if (event && message.event !== event) return;
      try {
        fn(JSON.parse(message.data) as T, message);
      } catch {
        // skip
      }
    };
    return this.on('message', handler);
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

  onStateChange(fn: EventMap['state']): this {
    return this.on('state', fn);
  }

  connect(): this {
    if (this.#state !== 'closed' || this.#closed) return this;
    this.#closed = false;
    void this.#run();
    return this;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#abort?.abort();
    this.#abort = undefined;
    this.#setState('closed');
    for (const fn of this.#listeners.close) fn();
  }

  /** Iterate messages until the source is closed. */
  async *[Symbol.asyncIterator](): AsyncIterator<SseMessage> {
    const queue: SseMessage[] = [];
    let wake: (() => void) | undefined;
    let done = false;
    const onMessage = (message: SseMessage) => {
      queue.push(message);
      wake?.();
    };
    const onClose = () => {
      done = true;
      wake?.();
    };
    this.on('message', onMessage);
    this.on('close', onClose);
    if (this.#closed) done = true;
    else if (this.#state === 'closed') this.connect();
    try {
      while (!done || queue.length > 0) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          wake = undefined;
          continue;
        }
        yield queue.shift()!;
      }
    } finally {
      this.off('message', onMessage);
      this.off('close', onClose);
    }
  }

  async #run(): Promise<void> {
    this.#setState('connecting');
    while (!this.#closed) {
      const abort = new AbortController();
      this.#abort = abort;
      let shouldReconnect = true;

      try {
        await this.#stream(abort.signal);
        // Stream ended cleanly (server closed). Reconnect per policy.
      } catch (error) {
        if (abort.signal.aborted || this.#closed) return;
        const err = error instanceof Error ? error : new Error(String(error));
        for (const fn of this.#listeners.error) fn(err);
        if (err instanceof SseHttpError && err.status >= 400 && err.status < 500 && err.status !== 429) {
          shouldReconnect = false;
        }
      }

      if (this.#closed) return;
      const delay = shouldReconnect ? this.#nextDelay() : undefined;
      if (delay === undefined) {
        this.close();
        return;
      }

      this.#attempts += 1;
      this.#setState('reconnecting');
      for (const fn of this.#listeners.reconnect) fn(this.#attempts);
      try {
        await sleep(delay, this.#options.signal);
      } catch {
        return;
      }
    }
  }

  #nextDelay(): number | undefined {
    const policy = this.#options.reconnect;
    if (policy === false) return undefined;
    const retries = policy?.retries ?? 5;
    if (this.#attempts >= retries) return undefined;
    if (this.#serverRetry !== undefined) return this.#serverRetry;
    const base = policy?.delay ?? 1000;
    let delay =
      (policy?.backoff ?? 'exponential') === 'exponential'
        ? Math.min(base * 2 ** this.#attempts, policy?.maxDelay ?? 30_000)
        : base;
    if (policy?.jitter) delay = delay / 2 + Math.random() * (delay / 2);
    return delay;
  }

  async #stream(signal: AbortSignal): Promise<void> {
    const headers: Record<string, string> = {
      accept: 'text/event-stream',
      'cache-control': 'no-cache',
      ...this.#options.headers,
    };
    if (this.#lastEventId !== undefined) headers['last-event-id'] = this.#lastEventId;

    const doFetch = this.#options.fetch ?? globalThis.fetch;
    const response = await doFetch(this.#url, {
      ...this.#options.fetchOptions,
      method: this.#options.method ?? 'GET',
      headers,
      body: this.#options.body,
      signal,
    } as RequestInit);

    if (!response.ok) {
      throw new SseHttpError(response.status, response);
    }
    if (!response.body) {
      throw new Error('SSE response has no body');
    }

    this.#attempts = 0;
    this.#setState('open');
    for (const fn of this.#listeners.open) fn();

    const parser = createSseParser(
      (message) => {
        for (const fn of this.#listeners.message) fn(message);
        const named = this.#named.get(message.event);
        if (named) for (const fn of named) fn(message);
      },
      {
        onId: (id) => {
          this.#lastEventId = id;
        },
        onRetry: (retry) => {
          this.#serverRetry = retry;
        },
      },
    );

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.push(decoder.decode(value, { stream: true }));
      }
      parser.push(decoder.decode());
      parser.end();
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // ignore
      }
    }
  }

  #setState(state: SseReadyState): void {
    if (this.#state === state) return;
    this.#state = state;
    for (const fn of this.#listeners.state) fn(state);
  }
}

export interface SubscribeSseOptions extends QEventSourceOptions {
  onMessage?: (message: SseMessage) => void;
  onEvent?: Record<string, (message: SseMessage) => void>;
  onError?: (error: Error) => void;
  onOpen?: () => void;
}

/** Open a source bound to `signal`; returns it already connected. */
export function subscribeSse(
  url: string,
  options: SubscribeSseOptions = {},
  signal?: AbortSignal,
): QEventSource {
  const { onMessage, onEvent, onError, onOpen, ...rest } = options;
  const source = new QEventSource(url, { ...rest, signal: signal ?? rest.signal });
  if (onMessage) source.onMessage(onMessage);
  if (onError) source.onError(onError);
  if (onOpen) source.onOpen(onOpen);
  if (onEvent) {
    for (const [name, fn] of Object.entries(onEvent)) source.onEvent(name, fn);
  }
  return source.connect();
}
