import type { QHttpError } from '../errors/qhttp-error.js';

export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS';

export type ResponseType =
  | 'auto'
  | 'json'
  | 'text'
  | 'blob'
  | 'arrayBuffer'
  | 'stream';

export type FetchStatus = 'idle' | 'loading' | 'success' | 'error';

export type QueryValue =
  | string
  | number
  | boolean
  | Date
  | null
  | undefined
  | QueryValue[]
  | { [key: string]: QueryValue };

export type QueryParams = Record<string, QueryValue>;

export type HeadersInit = Record<string, string | undefined>;

/** Token source: static string or (async) provider called on every request. */
export type TokenSource = string | (() => string | Promise<string>);

export interface AuthRefreshOptions {
  /** HTTP statuses that trigger a refresh. Default `[401]`. */
  on?: number[];
  /**
   * Refresh credentials. Return the new bearer token, or nothing when the
   * token source is a function that already reads fresh state.
   * Concurrent requests share one in-flight refresh.
   */
  run: () => Promise<string | void>;
}

export type AuthConfig =
  | { type: 'bearer'; token: TokenSource; refresh?: AuthRefreshOptions }
  | { type: 'basic'; username: string; password: string }
  | {
      type: 'custom';
      apply: (ctx: RequestContext) => void | Promise<void>;
      refresh?: AuthRefreshOptions;
    };

export type BackoffStrategy = 'fixed' | 'exponential';

export interface RetryOptions {
  retries?: number;
  backoff?: BackoffStrategy;
  retryDelay?: number;
  maxDelay?: number;
  jitter?: boolean;
  retryOn?: (error: unknown, attempt: number) => boolean;
}

export type RequestBody =
  | string
  | Record<string, unknown>
  | unknown[]
  | FormData
  | URLSearchParams
  | Blob
  | ArrayBuffer
  | ArrayBufferView
  | ReadableStream<Uint8Array>;

export type CacheMode = 'ttl' | 'http';

export interface HttpCacheOptions {
  shared?: boolean;
  cacheHeuristic?: number;
  immutableMinTimeToLive?: number;
  ignoreCargoCult?: boolean;
  /**
   * How long a stale entry stays in the engine past its freshness lifetime so
   * it can serve conditional revalidation and stale-while-revalidate.
   * Default 24h.
   */
  staleRetentionMs?: number;
}

/**
 * Options forwarded verbatim to the transport (`fetch` init for the default
 * adapter). `method`, `headers`, `body` and `signal` are owned by QHttp.
 */
export type FetchOptions = Omit<RequestInit, 'method' | 'headers' | 'body' | 'signal'> & {
  /** undici `Dispatcher` / `Agent` on Node. */
  dispatcher?: unknown;
  [key: string]: unknown;
};

export interface StandardSchemaIssue {
  message: string;
  path?: ReadonlyArray<unknown>;
}

export type StandardSchemaResult<T> =
  | { value: T; issues?: undefined }
  | { issues: ReadonlyArray<StandardSchemaIssue> };

/** Standard Schema v1 subset. zod, valibot, arktype and others implement it. */
export interface StandardSchema<T = unknown> {
  '~standard': {
    version: 1;
    vendor: string;
    validate: (value: unknown) => StandardSchemaResult<T> | Promise<StandardSchemaResult<T>>;
  };
}

export type ResponseParser<T = unknown> =
  | StandardSchema<T>
  | ((data: unknown) => T | Promise<T>);

export interface RateLimitOptions {
  /** Sustained requests per second per origin. */
  requestsPerSecond?: number;
  /** Bucket size. Default `requestsPerSecond`. */
  burst?: number;
  /** Max in-flight requests per origin. */
  concurrency?: number;
}

export interface CircuitBreakerOptions {
  /** Consecutive failures before the circuit opens. Default 5. */
  failureThreshold?: number;
  /** Time the circuit stays open before a trial request. Default 30s. */
  resetAfterMs?: number;
  /** Which errors count as failures. Default: NETWORK, TIMEOUT and 5xx. */
  isFailure?: (error: QHttpError) => boolean;
}

/** Options accepted per call: `client.get(url, options)` / `client.request(options)`. */
export interface RequestOptions<T = unknown> {
  url?: string;
  method?: HttpMethod;
  params?: QueryParams;
  headers?: HeadersInit;
  body?: RequestBody;
  macros?: Record<string, string | number>;
  timeout?: number;
  /** Total time budget across retries, in ms. */
  deadline?: number;
  responseType?: ResponseType;
  signal?: AbortSignal;
  retry?: RetryOptions | false;
  cache?: boolean;
  cacheTTL?: number;
  cacheKey?: string | ((ctx: RequestContext) => string);
  auth?: AuthConfig | false;
  throwOnError?: boolean;
  validateStatus?: (httpStatus: number) => boolean;
  fetchOptions?: FetchOptions;
  parse?: ResponseParser<T>;
  /** Share one in-flight request between identical concurrent safe calls. */
  dedupe?: boolean;
  onProgress?: (event: ProgressEvent) => void;
  /** Free-form data available to middleware and hooks as `ctx.meta`. */
  meta?: Record<string, unknown>;
}

export interface QHttpConfig {
  baseUrl?: string;
  url?: string;
  method?: HttpMethod;
  headers?: HeadersInit;
  queryParams?: QueryParams;
  body?: RequestBody;
  timeout?: number;
  deadline?: number;
  responseType?: ResponseType;
  adapter?: HttpAdapter;
  retry?: RetryOptions;
  cache?: boolean;
  cacheMode?: CacheMode;
  cacheTTL?: number;
  cacheEngine?: CacheEngine;
  cacheKey?: string | ((ctx: RequestContext) => string);
  cacheWhen?: (ctx: RequestContext, result?: QHttpResult) => boolean;
  cacheMethods?: HttpMethod[];
  /** Request headers mixed (hashed) into the default cache key. Default `['authorization']`. */
  cacheVary?: string[];
  httpCache?: HttpCacheOptions;
  auth?: AuthConfig;
  signal?: AbortSignal;
  throwOnError?: boolean;
  validateStatus?: (httpStatus: number) => boolean;
  paramsSerializer?: (params: QueryParams) => string;
  urlMacros?: Record<string, string | number>;
  fetchOptions?: FetchOptions;
  parse?: ResponseParser;
  dedupe?: boolean;
  rateLimit?: RateLimitOptions | RateLimiterLike;
  circuitBreaker?: CircuitBreakerOptions | CircuitBreakerLike;
  meta?: Record<string, unknown>;
}

export interface RateLimiterLike {
  acquire(origin: string, signal?: AbortSignal): Promise<() => void>;
}

export interface CircuitBreakerLike {
  check(origin: string): void;
  recordSuccess(origin: string): void;
  recordFailure(origin: string, error: QHttpError): void;
}

export interface RequestTiming {
  startedAt: number;
  endedAt: number;
  durationMs: number;
  attempts: number;
}

/** Internal per-run state shared by built-in middleware. */
export interface RequestRunState {
  /** Set by the cache middleware while a conditional request is in flight. */
  httpRevalidate?: unknown;
  /** Current attempt, 1-based. Bumped by the retry middleware. */
  attempt: number;
  /** Set once the auth middleware refreshed credentials for this run. */
  authRefreshed?: boolean;
  /** Resolved cache key when caching applies. */
  cacheKey?: string;
}

export interface RequestContext {
  requestId: string;
  startedAt: number;
  baseUrl?: string;
  url: string;
  resolvedUrl: string;
  method: HttpMethod;
  headers: Map<string, string>;
  queryParams: QueryParams;
  body?: RequestBody;
  timeout?: number;
  deadline?: number;
  responseType: ResponseType;
  /** Request-scope signal: user signal + `cancel()` + deadline. */
  signal?: AbortSignal;
  macros: Record<string, string | number>;
  auth?: AuthConfig;
  onProgress?: (event: ProgressEvent) => void;
  duplex?: 'half';
  fetchOptions?: FetchOptions;
  parse?: ResponseParser;
  validateStatus?: (httpStatus: number) => boolean;
  meta: Record<string, unknown>;
  state: RequestRunState;
}

export interface ProgressEvent {
  loaded: number;
  total?: number;
  direction: 'upload' | 'download';
}

export interface FinalRequest {
  url: string;
  method: HttpMethod;
  headers: Record<string, string>;
  body?: BodyInit | null;
  signal?: AbortSignal;
  duplex?: 'half';
  /** Transport passthrough (fetch init fields such as `credentials`). */
  init?: FetchOptions;
}

export interface RawResponseLike {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Headers | Record<string, string>;
  body: ReadableStream<Uint8Array> | null;
  arrayBuffer: () => Promise<ArrayBuffer>;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
  blob: () => Promise<Blob>;
  /** Native response when the transport has one. */
  raw?: Response;
}

export interface HttpAdapter {
  send(request: FinalRequest): Promise<RawResponseLike>;
}

export interface QHttpResult<T = unknown> {
  data: T;
  httpStatus: number;
  statusText: string;
  headers: Record<string, string>;
  ok: boolean;
  /** Native `Response` when the adapter exposes one (never for cache hits). */
  response?: Response;
  request: FinalRequest;
  fetchStatus: FetchStatus;
  fromCache: boolean;
  error?: QHttpError;
  requestId: string;
  timing: RequestTiming;
}

export interface CacheSnapshot {
  data: unknown;
  httpStatus: number;
  statusText: string;
  headers: Record<string, string>;
}

export interface HttpCacheEntry {
  v: 1;
  kind: 'http';
  data: unknown;
  httpStatus: number;
  statusText: string;
  headers: Record<string, string>;
  policy: object;
}

export interface CacheEngine {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  deleteByPrefix?(prefix: string): Promise<void>;
}

export type StateChangeHandler = (
  status: FetchStatus,
  ctx: { result?: QHttpResult; error?: QHttpError },
) => void;

export type PreRequestHook = (
  ctx: RequestContext,
) => void | Partial<RequestContext> | Promise<void | Partial<RequestContext>>;

export type PostRequestHook = (
  payload: { result: QHttpResult; ctx: RequestContext },
) =>
  | void
  | Partial<{ result: QHttpResult; ctx: RequestContext }>
  | Promise<void | Partial<{ result: QHttpResult; ctx: RequestContext }>>;

export type ErrorHook = (
  error: QHttpError,
) => void | QHttpResult | Promise<void | QHttpResult>;

export type RetryHook = (payload: { attempt: number; error: unknown }) => void | Promise<void>;

export type HookPhase =
  | 'preRequest'
  | 'postRequest'
  | 'onError'
  | 'onRetry'
  | 'preCache'
  | 'postCache'
  | (string & {});

export type HookFn = (ctx: unknown) => unknown | Promise<unknown>;

/** Continue the pipeline. Pass a context to run downstream with a different one. */
export type Next = (ctx?: RequestContext) => Promise<QHttpResult>;

/** Koa-style request middleware: `(ctx, next) => result`. */
export type Middleware = (ctx: RequestContext, next: Next) => Promise<QHttpResult>;
