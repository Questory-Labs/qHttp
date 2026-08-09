import type { BackoffStrategy } from '../core/types.js';
import { computeRetryDelay } from '../retry/retry.js';
import { sleep } from '../utils/abortable.js';
import type { ResourceDefaults, ResourceRetryOptions } from './types.js';

export type ResolvedResourceRetry = {
  retries: number | false;
  retryDelay: number;
  backoff: BackoffStrategy;
  maxDelay: number;
  jitter: boolean;
};

/**
 * Resolve load-retry policy.
 * Default `retries: false` — transport (QHttp.setRetry) owns retries.
 */
export function resolveResourceRetry(
  opts?: ResourceRetryOptions,
  defaults?: ResourceDefaults,
): ResolvedResourceRetry {
  return {
    retries: opts?.retries ?? defaults?.retries ?? false,
    retryDelay: opts?.retryDelay ?? defaults?.retryDelay ?? 300,
    backoff: opts?.backoff ?? defaults?.backoff ?? 'exponential',
    maxDelay: opts?.maxDelay ?? defaults?.maxDelay ?? 30_000,
    jitter: opts?.jitter ?? defaults?.jitter ?? false,
  };
}

/** Finite attempts; aborts mid-backoff when `signal` fires. */
export async function runWithRetry<T>(
  fn: () => Promise<T>,
  config: ResolvedResourceRetry,
  signal?: AbortSignal,
): Promise<T> {
  const maxAttempts = config.retries === false ? 1 : config.retries + 1;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt >= maxAttempts - 1) break;
      await sleep(
        Math.min(computeRetryDelay(attempt + 1, config), config.maxDelay),
        signal,
      );
    }
  }

  throw lastError;
}
