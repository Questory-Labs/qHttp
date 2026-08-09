import { isQHttpError, QHttpError } from '../errors/qhttp-error.js';
import type { HttpMethod, RetryOptions } from '../core/types.js';
import { sleep } from '../utils/abortable.js';

const IDEMPOTENT_METHODS = new Set<HttpMethod>(['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS']);

export interface RetryExecutionOptions extends Required<Pick<RetryOptions, 'retries' | 'retryDelay'>> {
  backoff: NonNullable<RetryOptions['backoff']>;
  maxDelay: number;
  jitter: boolean;
  retryOn?: RetryOptions['retryOn'];
  signal?: AbortSignal;
  method: HttpMethod;
  onRetry?: (attempt: number, error: unknown) => void | Promise<void>;
}

export type RetryDefaults = Omit<RetryExecutionOptions, 'method' | 'signal' | 'onRetry'>;

export function withDefaults(options?: RetryOptions): RetryDefaults | undefined {
  if (!options || options.retries === undefined || options.retries <= 0) {
    return undefined;
  }

  return {
    retries: options.retries,
    retryDelay: options.retryDelay ?? 300,
    backoff: options.backoff ?? 'exponential',
    maxDelay: options.maxDelay ?? 30_000,
    jitter: options.jitter ?? false,
    retryOn: options.retryOn,
  };
}

export async function withRetry<T>(
  exec: () => Promise<T>,
  options: RetryExecutionOptions,
): Promise<T> {
  let attempt = 0;

  while (true) {
    try {
      return await exec();
    } catch (error) {
      attempt++;
      const shouldRetry =
        attempt <= options.retries &&
        (options.retryOn?.(error, attempt) ?? isRetryableDefault(error, options.method));

      if (!shouldRetry) {
        throw error;
      }

      await options.onRetry?.(attempt, error);

      const retryAfter = retryAfterMs(error);
      const delay = Math.min(
        retryAfter ?? computeRetryDelay(attempt, options),
        options.maxDelay,
      );

      await sleep(delay, options.signal);
    }
  }
}

export function isRetryableDefault(error: unknown, method: HttpMethod): boolean {
  if (!IDEMPOTENT_METHODS.has(method)) {
    return false;
  }

  if (isQHttpError(error)) {
    if (error.code === 'TIMEOUT' || error.code === 'NETWORK') return true;
    if (error.httpStatus) {
      return [408, 425, 429, 502, 503, 504].includes(error.httpStatus);
    }
  }

  if (error instanceof TypeError) {
    return true;
  }

  return false;
}

export function computeRetryDelay(
  attempt: number,
  options: Pick<RetryExecutionOptions, 'retryDelay' | 'backoff' | 'jitter'>,
): number {
  const base =
    options.backoff === 'exponential'
      ? options.retryDelay * 2 ** (attempt - 1)
      : options.retryDelay;
  return applyJitter(base, options.jitter);
}

function applyJitter(delay: number, enabled: boolean): number {
  if (!enabled) return delay;
  return Math.random() * delay;
}

function retryAfterMs(error: unknown): number | undefined {
  if (!isQHttpError(error) || !error.result?.headers) {
    return undefined;
  }

  const header = error.result.headers['retry-after'] ?? error.result.headers['Retry-After'];
  if (!header) return undefined;

  const seconds = Number(header);
  if (!Number.isNaN(seconds)) {
    return seconds * 1000;
  }

  const date = Date.parse(header);
  if (!Number.isNaN(date)) {
    return Math.max(0, date - Date.now());
  }

  return undefined;
}

export function createRetryError(original: unknown): QHttpError {
  if (isQHttpError(original)) {
    return original;
  }
  return new QHttpError('Request failed', { cause: original, code: 'NETWORK' });
}
