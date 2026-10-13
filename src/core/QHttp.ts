import { defaultFetchAdapter } from '../adapters/fetch-adapter.js';
import {
  configureDefaultCacheEngine,
  getDefaultCacheEngine,
} from '../cache/default-cache-engine.js';
import { assertProgressCompatible, toRequestSummary } from './body.js';
import { buildRequestContext } from './build-request.js';
import { createFetchStatusManager } from './fetch-status.js';
import { createPaginator, type PaginateOptions, type Paginator } from './paginate.js';
import { asTerminal, compose } from './pipeline.js';
import { timingFor } from './result.js';
import { HookManager } from '../interceptors/hook-manager.js';
import { createAuthMiddleware } from '../middleware/auth.js';
import { createCacheMiddleware } from '../middleware/cache.js';
import { createDedupeMiddleware } from '../middleware/dedupe.js';
import { CircuitBreaker, RateLimiter, createRateLimitMiddleware } from '../middleware/rate-limit.js';
import { createRetryMiddleware } from '../middleware/retry.js';
import { timeoutMiddleware } from '../middleware/timeout.js';
import { abortErrorFor, createTransport } from '../middleware/transport.js';
import { contextToConfig, isAbortError, isQHttpError, QHttpError } from '../errors/qhttp-error.js';
import type {
  AuthConfig,
  CacheEngine,
  CircuitBreakerLike,
  CircuitBreakerOptions,
  ErrorHook,
  FetchOptions,
  FetchStatus,
  HeadersInit,
  HttpAdapter,
  HttpCacheOptions,
  HttpMethod,
  Middleware,
  PostRequestHook,
  PreRequestHook,
  ProgressEvent,
  QHttpConfig,
  QHttpResult,
  QueryParams,
  RateLimiterLike,
  RateLimitOptions,
  RequestBody,
  RequestContext,
  RequestOptions,
  ResponseParser,
  ResponseType,
  RetryHook,
  RetryOptions,
  StateChangeHandler,
} from './types.js';
import { composeSignal, readAbortReason, type ComposedSignal } from '../utils/abortable.js';
import { mergeQueryParams } from '../utils/query.js';

export type RequestCall<T = unknown> = RequestOptions<T> & { method?: HttpMethod };

/** Errors that describe a received response rather than a failed transport. */
const RESPONSE_ERRORS = new Set(['HTTP_ERROR', 'PARSE_ERROR', 'VALIDATION_ERROR']);

/**
 * HTTP client. Instance setters configure defaults; every call may pass
 * per-request options that override them without mutating the instance, so
 * one client can serve concurrent callers safely.
 */
export class QHttp {
  #config: QHttpConfig;
  #hooks = new HookManager();
  #middleware: Middleware[] = [];
  #fetchStatus = createFetchStatusManager();
  #progressHandler?: (event: ProgressEvent) => void;
  #active = new Set<ComposedSignal>();
  #inflight = new Map<string, Promise<QHttpResult>>();
  #refreshState: { pending?: Promise<string | void> } = {};

  constructor(config: QHttpConfig = {}) {
    this.#config = {
      throwOnError: true,
      validateStatus: (status) => status >= 200 && status < 300,
      responseType: 'auto',
      ...config,
    };
    if (config.rateLimit) this.rateLimit(config.rateLimit);
    if (config.circuitBreaker) this.circuitBreaker(config.circuitBreaker);
  }

  // ---------------------------------------------------------------- statics

  static configureDefaultCacheEngine(engine: CacheEngine): void {
    configureDefaultCacheEngine(engine);
  }

  static async getCache<T = unknown>(key: string): Promise<T | undefined> {
    return (await getDefaultCacheEngine().get(key)) as T | undefined;
  }

  static async setCache(key: string, value: unknown, ttlMs?: number): Promise<void> {
    await getDefaultCacheEngine().set(key, value, ttlMs);
  }

  static async deleteCache(key: string): Promise<void> {
    await getDefaultCacheEngine().delete(key);
  }

  static async deleteCacheByPrefix(prefix: string): Promise<void> {
    const engine = getDefaultCacheEngine();
    if (engine.deleteByPrefix) {
      await engine.deleteByPrefix(prefix);
    }
  }

  static async clearCache(): Promise<void> {
    await getDefaultCacheEngine().clear();
  }

  // ------------------------------------------------------------- properties

  /** Status of the most recent transition. In-flight count is `inFlight`. */
  get fetchStatus(): FetchStatus {
    return this.#fetchStatus.status;
  }

  get inFlight(): number {
    return this.#active.size;
  }

  /** Read-only view of the resolved configuration. */
  get config(): Readonly<QHttpConfig> {
    return this.#config;
  }

  // ---------------------------------------------------------------- setters

  setBaseUrl(baseUrl: string): this {
    this.#config.baseUrl = baseUrl;
    return this;
  }

  setUrl(url: string): this {
    this.#config.url = url;
    return this;
  }

  replaceUrlMacros(macros: Record<string, string | number>): this {
    this.#config.urlMacros = { ...this.#config.urlMacros, ...macros };
    return this;
  }

  setQueryParams(params: QueryParams): this {
    this.#config.queryParams = mergeQueryParams(this.#config.queryParams, params);
    return this;
  }

  paramsSerializer(fn: (params: QueryParams) => string): this {
    this.#config.paramsSerializer = fn;
    return this;
  }

  setHeaders(headers: HeadersInit): this {
    this.#config.headers = { ...this.#config.headers, ...headers };
    return this;
  }

  setBody(body: RequestBody): this {
    this.#config.body = body;
    return this;
  }

  setTimeout(timeout: number): this {
    this.#config.timeout = timeout;
    return this;
  }

  /** Total time budget across retries. */
  setDeadline(deadline: number): this {
    this.#config.deadline = deadline;
    return this;
  }

  setResponseType(responseType: ResponseType): this {
    this.#config.responseType = responseType;
    return this;
  }

  setRetry(options: RetryOptions): this {
    this.#config.retry = options;
    return this;
  }

  /** Fetch init passthrough: `credentials`, `cache`, `redirect`, `keepalive`, `dispatcher`... */
  setFetchOptions(options: FetchOptions): this {
    this.#config.fetchOptions = { ...this.#config.fetchOptions, ...options };
    return this;
  }

  /** Validate / transform every successful response body (Standard Schema or function). */
  parse<T>(parser: ResponseParser<T>): this {
    this.#config.parse = parser as ResponseParser;
    return this;
  }

  /** Share one in-flight response between identical concurrent safe requests. */
  dedupe(enabled = true): this {
    this.#config.dedupe = enabled;
    return this;
  }

  rateLimit(options: RateLimitOptions | RateLimiterLike | false): this {
    if (options === false) {
      this.#config.rateLimit = undefined;
    } else {
      this.#config.rateLimit = isLimiter(options) ? options : new RateLimiter(options);
    }
    return this;
  }

  circuitBreaker(options: CircuitBreakerOptions | CircuitBreakerLike | false): this {
    if (options === false) {
      this.#config.circuitBreaker = undefined;
    } else {
      this.#config.circuitBreaker = isBreaker(options) ? options : new CircuitBreaker(options);
    }
    return this;
  }

  setMeta(meta: Record<string, unknown>): this {
    this.#config.meta = { ...this.#config.meta, ...meta };
    return this;
  }

  cache(enabled = true): this {
    this.#config.cache = enabled;
    if (enabled && this.#config.cacheMode === undefined) {
      this.#config.cacheMode = 'ttl';
    }
    return this;
  }

  httpCache(options: HttpCacheOptions = {}): this {
    this.#config.cache = true;
    this.#config.cacheMode = 'http';
    this.#config.httpCache = options;
    return this;
  }

  cacheTTL(ttlMs: number): this {
    this.#config.cacheTTL = ttlMs;
    return this;
  }

  cacheEngine(engine: CacheEngine): this {
    this.#config.cacheEngine = engine;
    return this;
  }

  cacheKey(key: string | ((ctx: RequestContext) => string)): this {
    this.#config.cacheKey = key;
    return this;
  }

  cacheWhen(fn: (ctx: RequestContext, result?: QHttpResult) => boolean): this {
    this.#config.cacheWhen = fn;
    return this;
  }

  cacheMethods(methods: HttpMethod[]): this {
    this.#config.cacheMethods = methods;
    return this;
  }

  /** Request headers hashed into the default cache key. Default `['authorization']`. */
  cacheVary(headers: string[]): this {
    this.#config.cacheVary = headers;
    return this;
  }

  getCacheEngine(): CacheEngine | undefined {
    if (this.#config.cacheEngine) return this.#config.cacheEngine;
    if (this.#config.cache) return getDefaultCacheEngine();
    return undefined;
  }

  setAuth(auth: AuthConfig): this {
    this.#config.auth = auth;
    return this;
  }

  setSignal(signal: AbortSignal): this {
    this.#config.signal = signal;
    return this;
  }

  setAdapter(adapter: HttpAdapter): this {
    this.#config.adapter = adapter;
    return this;
  }

  validateStatus(fn: (httpStatus: number) => boolean): this {
    this.#config.validateStatus = fn;
    return this;
  }

  throwOnError(enabled: boolean): this {
    this.#config.throwOnError = enabled;
    return this;
  }

  onProgress(handler: (event: ProgressEvent) => void): this {
    this.#progressHandler = handler;
    return this;
  }

  onStateChange(handler: StateChangeHandler): this {
    this.#fetchStatus.subscribe(handler);
    return this;
  }

  // ------------------------------------------------------- hooks/middleware

  preRequest(fn: PreRequestHook): this {
    this.#hooks.add('preRequest', fn as (ctx: unknown) => unknown);
    return this;
  }

  postRequest(fn: PostRequestHook): this {
    this.#hooks.add('postRequest', fn as (ctx: unknown) => unknown);
    return this;
  }

  onError(fn: ErrorHook): this {
    this.#hooks.add('onError', fn as (ctx: unknown) => unknown);
    return this;
  }

  onRetry(fn: RetryHook): this {
    this.#hooks.add('onRetry', fn as (ctx: unknown) => unknown);
    return this;
  }

  hook(phase: string, fn: (ctx: unknown) => unknown): this {
    this.#hooks.add(phase, fn);
    return this;
  }

  /**
   * Add middleware. User middleware runs outermost: after `preRequest` hooks,
   * before auth, cache, dedupe, retry, timeout, rate limiting and transport.
   */
  use(middleware: Middleware): this {
    this.#middleware.push(middleware);
    return this;
  }

  // ------------------------------------------------------------- lifecycle

  /** Abort every in-flight request started from this instance. */
  cancel(): void {
    for (const scope of this.#active) scope.cancel();
  }

  reset(): this {
    this.#fetchStatus.reset();
    return this;
  }

  clone(): QHttp {
    const copy = new QHttp({
      ...this.#config,
      headers: { ...this.#config.headers },
      queryParams: { ...this.#config.queryParams },
      urlMacros: { ...this.#config.urlMacros },
      fetchOptions: this.#config.fetchOptions ? { ...this.#config.fetchOptions } : undefined,
      meta: this.#config.meta ? { ...this.#config.meta } : undefined,
    });
    copy.#hooks = this.#hooks.clone();
    copy.#middleware = [...this.#middleware];
    copy.#progressHandler = this.#progressHandler;
    copy.#inflight = this.#inflight;
    copy.#refreshState = this.#refreshState;
    return copy;
  }

  // ----------------------------------------------------------------- verbs

  get<T = unknown>(url?: string, options?: RequestOptions<T>): Promise<QHttpResult<T>> {
    return this.request<T>({ ...options, method: 'GET', url: options?.url ?? url });
  }

  post<T = unknown>(url?: string, options?: RequestOptions<T>): Promise<QHttpResult<T>> {
    return this.request<T>({ ...options, method: 'POST', url: options?.url ?? url });
  }

  put<T = unknown>(url?: string, options?: RequestOptions<T>): Promise<QHttpResult<T>> {
    return this.request<T>({ ...options, method: 'PUT', url: options?.url ?? url });
  }

  patch<T = unknown>(url?: string, options?: RequestOptions<T>): Promise<QHttpResult<T>> {
    return this.request<T>({ ...options, method: 'PATCH', url: options?.url ?? url });
  }

  delete<T = unknown>(url?: string, options?: RequestOptions<T>): Promise<QHttpResult<T>> {
    return this.request<T>({ ...options, method: 'DELETE', url: options?.url ?? url });
  }

  head<T = unknown>(url?: string, options?: RequestOptions<T>): Promise<QHttpResult<T>> {
    return this.request<T>({ ...options, method: 'HEAD', url: options?.url ?? url });
  }

  options<T = unknown>(url?: string, options?: RequestOptions<T>): Promise<QHttpResult<T>> {
    return this.request<T>({ ...options, method: 'OPTIONS', url: options?.url ?? url });
  }

  /** Iterate pages. See `pageParam`, `cursorParam`, `linkHeader` helpers. */
  paginate<T = unknown>(options: PaginateOptions<T>): Paginator<T> {
    return createPaginator<T>((opts) => this.request<T>(opts), options);
  }

  async request<T = unknown>(call: RequestCall<T> = {}): Promise<QHttpResult<T>> {
    const { method: methodOverride, url: urlOverride, ...options } = call;
    const method = methodOverride ?? this.#config.method ?? 'GET';
    const onProgress = options.onProgress ?? this.#progressHandler;
    const responseType = options.responseType ?? this.#config.responseType ?? 'auto';
    assertProgressCompatible(responseType, !!onProgress);

    const callOptions: RequestOptions = { ...(options as RequestOptions), onProgress };
    let ctx = buildRequestContext({
      config: this.#config,
      method,
      urlOverride,
      options: callOptions,
    });

    ctx = await this.#hooks.run('preRequest', ctx);

    const scope = composeSignal(ctx.signal, {
      timeoutMs: ctx.deadline,
      timeoutReason: 'DEADLINE',
    });
    ctx.signal = scope.signal;
    this.#active.add(scope);
    this.#fetchStatus.set('loading');

    const throwOnError = options.throwOnError ?? this.#config.throwOnError;
    const chain = compose([
      ...this.#middleware,
      createAuthMiddleware({
        refreshState: this.#refreshState,
        onToken: (token) => {
          const auth = this.#config.auth;
          if (auth?.type === 'bearer') this.#config.auth = { ...auth, token };
        },
      }),
      createCacheMiddleware({ config: this.#config, options: callOptions, hooks: this.#hooks }),
      createDedupeMiddleware({
        enabled: callOptions.dedupe ?? this.#config.dedupe ?? false,
        inflight: this.#inflight,
        vary: this.#config.cacheVary,
      }),
      createRetryMiddleware({
        retry: callOptions.retry === undefined ? this.#config.retry : callOptions.retry,
        hooks: this.#hooks,
      }),
      timeoutMiddleware,
      createRateLimitMiddleware({
        limiter: this.#config.rateLimit as RateLimiterLike | undefined,
        breaker: this.#config.circuitBreaker as CircuitBreakerLike | undefined,
      }),
    ]);
    const transport = asTerminal(createTransport(this.#config.adapter ?? defaultFetchAdapter));

    try {
      const result = (await chain(ctx, transport)) as QHttpResult<T>;
      this.#fetchStatus.set('success', { result });
      const payload = await this.#hooks.run('postRequest', { result, ctx });
      return payload.result as QHttpResult<T>;
    } catch (error) {
      const qError = this.#normalizeError(error, ctx, scope);
      const recovered = await this.#runErrorHooks(qError);
      if (recovered) {
        this.#fetchStatus.set('success', { result: recovered });
        return recovered as QHttpResult<T>;
      }

      this.#fetchStatus.set('error', { error: qError });

      if (throwOnError === false) {
        return this.#failedResult<T>(qError, ctx);
      }

      throw qError;
    } finally {
      scope.cleanup();
      this.#active.delete(scope);
    }
  }

  // --------------------------------------------------------------- private

  #failedResult<T>(error: QHttpError, ctx: RequestContext): QHttpResult<T> {
    const partial = error.result;
    return {
      data: partial?.data as T,
      httpStatus: error.httpStatus ?? partial?.httpStatus ?? 0,
      statusText: partial?.statusText ?? error.message,
      headers: partial?.headers ?? {},
      ok: false,
      response: error.response ?? partial?.response,
      request:
        partial?.request ??
        toRequestSummary({
          url: ctx.resolvedUrl,
          method: ctx.method,
          headers: ctx.headers,
          signal: ctx.signal,
          init: ctx.fetchOptions,
        }),
      fetchStatus: 'error',
      fromCache: false,
      error,
      requestId: ctx.requestId,
      timing: timingFor(ctx),
    };
  }

  async #runErrorHooks(error: QHttpError): Promise<QHttpResult | undefined> {
    const recovered = await this.#hooks.runErrorHooks(error);
    if (recovered && typeof recovered === 'object' && 'data' in recovered) {
      return recovered as QHttpResult;
    }
    return undefined;
  }

  #normalizeError(error: unknown, ctx: RequestContext, scope: ComposedSignal): QHttpError {
    // Once the request scope aborted (cancel, user signal, deadline), report that
    // reason even if a transport ignored the signal and failed some other way.
    if (scope.signal.aborted && !(isQHttpError(error) && RESPONSE_ERRORS.has(error.code))) {
      return abortErrorFor(scope.reason ?? readAbortReason(ctx.signal), ctx, error);
    }
    if (isQHttpError(error)) return error;
    if (isAbortError(error)) {
      return abortErrorFor(scope.reason ?? readAbortReason(ctx.signal), ctx, error);
    }
    return new QHttpError('Network request failed', {
      code: 'NETWORK',
      request: contextToConfig(ctx),
      cause: error,
    });
  }
}

function isLimiter(value: RateLimitOptions | RateLimiterLike): value is RateLimiterLike {
  return typeof (value as RateLimiterLike).acquire === 'function';
}

function isBreaker(value: CircuitBreakerOptions | CircuitBreakerLike): value is CircuitBreakerLike {
  return typeof (value as CircuitBreakerLike).check === 'function';
}
