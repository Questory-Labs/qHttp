import type { QHttp } from '../core/QHttp.js';
import type { BackoffStrategy } from '../core/types.js';

export type ResourceId = readonly unknown[];

export type ResourceRetryOptions = {
  /**
   * Retries after the first failed `load()` attempt.
   * Default `false` (one attempt): prefer `QHttp.setRetry` for HTTP transport.
   */
  retries?: number | false;
  retryDelay?: number;
  backoff?: BackoffStrategy;
  maxDelay?: number;
  jitter?: boolean;
};

export type ResourceDefaults = ResourceRetryOptions & {
  freshFor?: number;
  /** Time an unobserved resource is kept before collection. Default 5 min; `Infinity` keeps forever. */
  gcTime?: number;
};

export type LoadOpts = ResourceRetryOptions & {
  freshFor?: number;
  gcTime?: number;
};

export type ResourceSnapshot<T> = {
  value: T | undefined;
  error: Error | null;
  empty: boolean;
  busy: boolean;
  refreshing: boolean;
  updatedAt: number;
};

export type DehydratedResource = {
  id: ResourceId;
  value: unknown;
  updatedAt: number;
};

export type UseResourceOptions<T> = ResourceRetryOptions & {
  id: ResourceId;
  load?: () => Promise<T>;
  /** Preconfigured QHttp client: runs GET and unwraps `data`. */
  request?: QHttp;
  when?: boolean;
  freshFor?: number;
  gcTime?: number;
  refreshEvery?: number | false | ((value: T | undefined) => number | false);
  refreshOnFocus?: boolean;
  /** Keep showing the last value while a new id loads (`placeholder` is true meanwhile). */
  keepPrevious?: boolean;
};

export type OptimisticUpdate = readonly [ResourceId, (previous: unknown) => unknown];

export type UseActionOptions<TData, TInput> = {
  run: (input: TInput) => Promise<TData>;
  touches?: ResourceId[];
  /** Apply instantly; rolled back if `run` throws. */
  optimistic?: (input: TInput) => readonly OptimisticUpdate[];
  onSuccess?: (data: TData, input: TInput) => void | Promise<void>;
  onError?: (error: Error, input: TInput) => void | Promise<void>;
  onSettled?: (input: TInput) => void | Promise<void>;
};

export type LiveSubscribe = (
  onEvent: (raw: string) => void,
  signal: AbortSignal,
) => void | Promise<void>;

export type UseLiveResourceOptions<T> = Omit<
  UseResourceOptions<T>,
  'refreshEvery' | 'refreshOnFocus'
> & {
  /** Push source. Receives raw frames; return value is ignored. */
  subscribe?: LiveSubscribe;
  /** Shortcut: subscribe to a server-sent events URL. */
  sse?: string | { url: string; event?: string; headers?: Record<string, string>; withCredentials?: boolean };
  parse?: (raw: string) => T;
  /** Merge an incoming frame into the current value instead of replacing it. */
  merge?: (previous: T | undefined, incoming: T) => T;
};

export type UsePagedResourceOptions<TPage, TCursor = unknown> = ResourceRetryOptions & {
  id: ResourceId;
  loadPage: (cursor: TCursor | undefined) => Promise<TPage>;
  /** Cursor for the page after `page`, or a falsy value when there are no more. */
  nextCursor: (page: TPage, pages: readonly TPage[]) => TCursor | null | undefined | false;
  when?: boolean;
  freshFor?: number;
  gcTime?: number;
};

export type PagedValue<TPage, TCursor> = {
  pages: TPage[];
  cursors: Array<TCursor | undefined>;
};
