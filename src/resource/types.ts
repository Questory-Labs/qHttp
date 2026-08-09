import type { QHttp } from '../core/QHttp.js';
import type { BackoffStrategy } from '../core/types.js';

export type ResourceId = readonly unknown[];

export type ResourceRetryOptions = {
  /**
   * Retries after the first failed `load()` attempt.
   * Default `false` (one attempt) — prefer `QHttp.setRetry` for HTTP transport.
   */
  retries?: number | false;
  retryDelay?: number;
  backoff?: BackoffStrategy;
  maxDelay?: number;
  jitter?: boolean;
};

export type ResourceDefaults = ResourceRetryOptions & {
  freshFor?: number;
};

export type LoadOpts = ResourceRetryOptions & {
  freshFor?: number;
};

export type ResourceSnapshot<T> = {
  value: T | undefined;
  error: Error | null;
  empty: boolean;
  busy: boolean;
  refreshing: boolean;
  updatedAt: number;
};

export type UseResourceOptions<T> = ResourceRetryOptions & {
  id: ResourceId;
  load?: () => Promise<T>;
  /** Preconfigured QHttp client — runs GET and maps QHttpError to Error. */
  request?: QHttp;
  when?: boolean;
  freshFor?: number;
  refreshEvery?:
    | number
    | false
    | ((value: T | undefined) => number | false);
  refreshOnFocus?: boolean;
};

export type UseActionOptions<TData, TInput> = {
  run: (input: TInput) => Promise<TData>;
  touches?: ResourceId[];
  onSuccess?: (data: TData, input: TInput) => void | Promise<void>;
  onError?: (error: Error, input: TInput) => void | Promise<void>;
};

export type LiveSubscribe = (
  onEvent: (raw: string) => void,
  signal: AbortSignal,
) => void | Promise<void>;

export type UseLiveResourceOptions<T> = Omit<
  UseResourceOptions<T>,
  'refreshEvery' | 'refreshOnFocus'
> & {
  subscribe: LiveSubscribe;
  parse?: (raw: string) => T;
};
