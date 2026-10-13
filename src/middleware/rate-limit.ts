import type {
  CircuitBreakerLike,
  CircuitBreakerOptions,
  Middleware,
  RateLimiterLike,
  RateLimitOptions,
} from '../core/types.js';
import { isQHttpError, QHttpError } from '../errors/qhttp-error.js';
import { sleep } from '../utils/abortable.js';
import { originOf } from '../utils/url.js';

interface Bucket {
  tokens: number;
  lastRefill: number;
  active: number;
  waiters: Array<() => void>;
}

/** Per-origin token bucket plus concurrency cap. Share one instance across clients. */
export class RateLimiter implements RateLimiterLike {
  readonly #rate?: number;
  readonly #burst: number;
  readonly #concurrency?: number;
  readonly #buckets = new Map<string, Bucket>();

  constructor(options: RateLimitOptions = {}) {
    this.#rate = options.requestsPerSecond;
    this.#burst = options.burst ?? options.requestsPerSecond ?? 1;
    this.#concurrency = options.concurrency;
  }

  async acquire(origin: string, signal?: AbortSignal): Promise<() => void> {
    const bucket = this.#bucket(origin);
    await this.#waitForToken(bucket, signal);
    await this.#reserveSlot(bucket, signal);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      // Hand the slot straight to the next waiter; otherwise free it.
      const waiter = bucket.waiters.shift();
      if (waiter) waiter();
      else bucket.active -= 1;
    };
  }

  /** Current in-flight count for an origin (diagnostics). */
  activeFor(origin: string): number {
    return this.#buckets.get(origin)?.active ?? 0;
  }

  #bucket(origin: string): Bucket {
    let bucket = this.#buckets.get(origin);
    if (!bucket) {
      bucket = { tokens: this.#burst, lastRefill: Date.now(), active: 0, waiters: [] };
      this.#buckets.set(origin, bucket);
    }
    return bucket;
  }

  async #waitForToken(bucket: Bucket, signal?: AbortSignal): Promise<void> {
    if (!this.#rate) return;
    while (true) {
      const now = Date.now();
      const elapsed = (now - bucket.lastRefill) / 1000;
      bucket.tokens = Math.min(this.#burst, bucket.tokens + elapsed * this.#rate);
      bucket.lastRefill = now;
      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        return;
      }
      const waitMs = Math.ceil(((1 - bucket.tokens) / this.#rate) * 1000);
      await sleep(Math.max(1, waitMs), signal);
    }
  }

  /** Reserve a concurrency slot. The check and the increment happen synchronously. */
  #reserveSlot(bucket: Bucket, signal?: AbortSignal): Promise<void> {
    if (!this.#concurrency || bucket.active < this.#concurrency) {
      bucket.active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        const index = bucket.waiters.indexOf(wake);
        if (index >= 0) bucket.waiters.splice(index, 1);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      const wake = () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      };
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      bucket.waiters.push(wake);
    });
  }
}

type CircuitState = 'closed' | 'open' | 'half-open';

interface Circuit {
  state: CircuitState;
  failures: number;
  openedAt: number;
}

/** Per-origin circuit breaker: opens after consecutive failures, trials after a cool-down. */
export class CircuitBreaker implements CircuitBreakerLike {
  readonly #threshold: number;
  readonly #resetAfterMs: number;
  readonly #isFailure: (error: QHttpError) => boolean;
  readonly #circuits = new Map<string, Circuit>();

  constructor(options: CircuitBreakerOptions = {}) {
    this.#threshold = options.failureThreshold ?? 5;
    this.#resetAfterMs = options.resetAfterMs ?? 30_000;
    this.#isFailure =
      options.isFailure ??
      ((error) =>
        error.code === 'NETWORK' ||
        error.code === 'TIMEOUT' ||
        (error.httpStatus !== undefined && error.httpStatus >= 500));
  }

  stateOf(origin: string): CircuitState {
    return this.#circuit(origin).state;
  }

  check(origin: string): void {
    const circuit = this.#circuit(origin);
    if (circuit.state !== 'open') return;
    if (Date.now() - circuit.openedAt >= this.#resetAfterMs) {
      circuit.state = 'half-open';
      return;
    }
    throw new QHttpError(`Circuit open for ${origin}`, { code: 'CIRCUIT_OPEN' });
  }

  recordSuccess(origin: string): void {
    const circuit = this.#circuit(origin);
    circuit.state = 'closed';
    circuit.failures = 0;
  }

  recordFailure(origin: string, error: QHttpError): void {
    if (!this.#isFailure(error)) return;
    const circuit = this.#circuit(origin);
    circuit.failures += 1;
    if (circuit.state === 'half-open' || circuit.failures >= this.#threshold) {
      circuit.state = 'open';
      circuit.openedAt = Date.now();
    }
  }

  reset(origin?: string): void {
    if (origin) this.#circuits.delete(origin);
    else this.#circuits.clear();
  }

  #circuit(origin: string): Circuit {
    let circuit = this.#circuits.get(origin);
    if (!circuit) {
      circuit = { state: 'closed', failures: 0, openedAt: 0 };
      this.#circuits.set(origin, circuit);
    }
    return circuit;
  }
}

export interface RateLimitMiddlewareDeps {
  limiter?: RateLimiterLike;
  breaker?: CircuitBreakerLike;
}

/** Runs per attempt: breaker check, limiter slot, then records the outcome. */
export function createRateLimitMiddleware(deps: RateLimitMiddlewareDeps): Middleware {
  return async (ctx, next) => {
    if (!deps.limiter && !deps.breaker) return next();

    const origin = originOf(ctx.resolvedUrl);
    deps.breaker?.check(origin);

    const release = deps.limiter ? await deps.limiter.acquire(origin, ctx.signal) : undefined;
    try {
      const result = await next();
      deps.breaker?.recordSuccess(origin);
      return result;
    } catch (error) {
      if (isQHttpError(error)) deps.breaker?.recordFailure(origin, error);
      throw error;
    } finally {
      release?.();
    }
  };
}
