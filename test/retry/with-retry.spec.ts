import { describe, expect, it, vi } from 'vitest';
import { withRetry } from '../../src/retry/retry.js';
import { QHttpError } from '../../src/errors/qhttp-error.js';

describe('withRetry', () => {
  it('retries until success', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) {
          throw new QHttpError('fail', { httpStatus: 503 });
        }
        return 'ok';
      },
      {
        retries: 3,
        retryDelay: 1,
        backoff: 'fixed',
        maxDelay: 10,
        jitter: false,
        method: 'GET',
      },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('gives up after max retries', async () => {
    await expect(
      withRetry(
        async () => {
          throw new QHttpError('fail', { httpStatus: 503 });
        },
        {
          retries: 2,
          retryDelay: 1,
          backoff: 'fixed',
          maxDelay: 10,
          jitter: false,
          method: 'GET',
        },
      ),
    ).rejects.toBeInstanceOf(QHttpError);
  });
});
