import { describe, expect, it, vi, afterEach } from 'vitest';
import { QHttp } from '../../src/core/QHttp.js';
import { CircuitBreaker, RateLimiter } from '../../src/middleware/rate-limit.js';
import { QHttpError } from '../../src/errors/qhttp-error.js';
import { SpyAdapter, deferred, mockResponse } from '../helpers.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('RateLimiter', () => {
  it('caps concurrency per origin', async () => {
    const limiter = new RateLimiter({ concurrency: 2 });
    const r1 = await limiter.acquire('https://a');
    const r2 = await limiter.acquire('https://a');
    let third = false;
    const p3 = limiter.acquire('https://a').then((r) => {
      third = true;
      return r;
    });
    await Promise.resolve();
    expect(third).toBe(false);
    expect(limiter.activeFor('https://a')).toBe(2);
    // Other origins are independent.
    const other = await limiter.acquire('https://b');
    other();
    r1();
    const r3 = await p3;
    expect(third).toBe(true);
    r2();
    r3();
    expect(limiter.activeFor('https://a')).toBe(0);
  });

  it('paces requests per second', async () => {
    vi.useFakeTimers();
    const limiter = new RateLimiter({ requestsPerSecond: 2, burst: 1 });
    (await limiter.acquire('o'))();
    let acquired = false;
    const p = limiter.acquire('o').then((r) => {
      acquired = true;
      r();
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(acquired).toBe(false);
    await vi.advanceTimersByTimeAsync(500);
    await p;
    expect(acquired).toBe(true);
  });

  it('aborts waiters when the signal fires', async () => {
    const limiter = new RateLimiter({ concurrency: 1 });
    const release = await limiter.acquire('o');
    const ac = new AbortController();
    const pending = limiter.acquire('o', ac.signal);
    ac.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    release();
  });

  it('is applied per attempt through the client', async () => {
    const adapter = new SpyAdapter();
    const gate = deferred<void>();
    adapter.send.mockImplementation(async () => {
      await gate.promise;
      return mockResponse({});
    });
    const limiter = new RateLimiter({ concurrency: 1 });
    const client = new QHttp({ adapter }).rateLimit(limiter);

    const p1 = client.get('https://api.example.com/a');
    const p2 = client.get('https://api.example.com/b');
    await vi.waitFor(() => expect(adapter.send).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(adapter.send).toHaveBeenCalledTimes(1);
    gate.resolve();
    await Promise.all([p1, p2]);
    expect(adapter.send).toHaveBeenCalledTimes(2);
  });
});

describe('CircuitBreaker', () => {
  it('opens after consecutive failures and trials after reset', async () => {
    vi.useFakeTimers();
    const adapter = new SpyAdapter();
    adapter.send.mockResolvedValue(mockResponse({}, { status: 503 }));
    const breaker = new CircuitBreaker({ failureThreshold: 2, resetAfterMs: 1_000 });
    const client = new QHttp({ adapter }).circuitBreaker(breaker);

    await expect(client.get('https://api.example.com/x')).rejects.toMatchObject({ httpStatus: 503 });
    await expect(client.get('https://api.example.com/x')).rejects.toMatchObject({ httpStatus: 503 });
    expect(breaker.stateOf('https://api.example.com')).toBe('open');

    const err = await client.get('https://api.example.com/x').catch((e: unknown) => e);
    expect((err as QHttpError).code).toBe('CIRCUIT_OPEN');
    expect(adapter.send).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1_000);
    adapter.send.mockResolvedValue(mockResponse({ ok: true }));
    const recovered = await client.get('https://api.example.com/x');
    expect(recovered.ok).toBe(true);
    expect(breaker.stateOf('https://api.example.com')).toBe('closed');
  });

  it('ignores 4xx by default', () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1 });
    breaker.recordFailure('o', new QHttpError('x', { code: 'HTTP_ERROR', httpStatus: 404 }));
    expect(breaker.stateOf('o')).toBe('closed');
    breaker.recordFailure('o', new QHttpError('x', { code: 'NETWORK' }));
    expect(breaker.stateOf('o')).toBe('open');
    breaker.reset('o');
    expect(breaker.stateOf('o')).toBe('closed');
  });
});
