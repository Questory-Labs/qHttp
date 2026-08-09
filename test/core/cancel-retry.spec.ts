import { describe, expect, it, vi } from 'vitest';
import { QHttp } from '../../src/core/QHttp.js';
import { isQHttpError } from '../../src/errors/qhttp-error.js';
import type { HttpAdapter, FinalRequest, RawResponseLike } from '../../src/core/types.js';

describe('QHttp cancel during retry', () => {
  it('aborts while waiting on retry backoff', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const adapter: HttpAdapter = {
      async send(_request: FinalRequest): Promise<RawResponseLike> {
        calls += 1;
        throw new TypeError('Failed to fetch');
      },
    };

    const client = new QHttp({
      adapter,
      url: 'http://localhost/x',
      throwOnError: true,
    }).setRetry({
      retries: 3,
      retryDelay: 1_000,
      backoff: 'fixed',
      jitter: false,
    });

    const pending = client.get().catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(10);
    expect(calls).toBe(1);

    client.cancel();
    await vi.runAllTimersAsync();
    const err = await pending;
    expect(isQHttpError(err)).toBe(true);
    if (isQHttpError(err)) {
      expect(err.code).toBe('ABORTED');
    }
    expect(calls).toBe(1);

    vi.useRealTimers();
  });
});
