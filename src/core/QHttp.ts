import { applyAuth } from '../auth/auth.js';
import { defaultFetchAdapter } from '../adapters/fetch-adapter.js';
import { buildCacheKey } from '../cache/cache-key.js';
import {
  applyRevalidationHeaders,
  createHttpCacheEntry,
  hydrateHttpCacheResult,
  isHttpCacheEntry,
  lookupHttpCacheEntry,
  processRevalidationResponse,
  type HttpRevalidationContext,
} from '../cache/http-cache-policy.js';
import {
  configureDefaultCacheEngine,
  getDefaultCacheEngine,
} from '../cache/default-cache-engine.js';
import type { CacheEngine } from '../cache/cache-engine.interface.js';
import { LocalStorageCacheEngine } from '../cache/local-storage-cache-engine.js';
import {
  assertProgressCompatible,
  isBinaryResponseType,
  isReplayableBody,
  parseResponseBody,
  readResponseWithProgress,
  toFinalRequest,
} from './body.js';
import { buildRequestContext } from './build-request.js';
import { createFetchStatusManager } from './fetch-status.js';
import { HookManager } from '../interceptors/hook-manager.js';
import { contextToConfig, isAbortError, isQHttpError, QHttpError } from '../errors/qhttp-error.js';
import { withRetry, withDefaults } from '../retry/retry.js';
import type {
  AuthConfig,
  CacheSnapshot,
  ErrorHook,
  FetchStatus,
  FinalRequest,
  HeadersInit,
  HttpAdapter,
  HttpMethod,
  HttpCacheOptions,
  PostRequestHook,
  PreRequestHook,
  ProgressEvent,
  QHttpConfig,
  QHttpResult,
  QueryParams,
  RequestBody,
  RequestContext,
  ResponseType,
  RetryHook,
  RetryOptions,
  StateChangeHandler,
} from './types.js';
import { composeSignal, type ComposedSignal } from '../utils/abortable.js';
import { recordToHeaders } from '../utils/headers.js';
import { mergeQueryParams } from '../utils/query.js';

const DEFAULT_CACHE_METHODS: HttpMethod[] = ['GET', 'HEAD'];

export class QHttp {
  #config: QHttpConfig;
  #hooks = new HookManager();
  #fetchStatus = createFetchStatusManager();
  #activeController?: ComposedSignal;
  #progressHandler?: (event: ProgressEvent) => void;
  #explicitCacheEngine = false;

  constructor(config: QHttpConfig = {}) {
    this.#config = {
      throwOnError: true,
      validateStatus: (status) => status >= 200 && status < 300,
      responseType: 'auto',
      ...config,
    };
  }

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

  get fetchStatus(): FetchStatus {
    return this.#fetchStatus.status;
  }

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

  setResponseType(responseType: ResponseType): this {
    this.#config.responseType = responseType;
    return this;
  }

  setRetry(options: RetryOptions): this {
    this.#config.retry = options;
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
    this.#explicitCacheEngine = true;
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

  getCacheEngine(): CacheEngine | undefined {
    return this.#resolveCacheEngine();
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

  cancel(): void {
    this.#activeController?.cancel();
  }

  reset(): this {
    this.#fetchStatus.reset();
    return this;
  }

  clone(): QHttp {
    const copy = new QHttp({ ...this.#config, headers: { ...this.#config.headers } });
    copy.#hooks = this.#hooks.clone();
    copy.#progressHandler = this.#progressHandler;
    copy.#explicitCacheEngine = this.#explicitCacheEngine;
    return copy;
  }

  get<T = unknown>(url?: string): Promise<QHttpResult<T>> {
    return this.request<T>({ method: 'GET', url });
  }

  post<T = unknown>(url?: string): Promise<QHttpResult<T>> {
    return this.request<T>({ method: 'POST', url });
  }

  put<T = unknown>(url?: string): Promise<QHttpResult<T>> {
    return this.request<T>({ method: 'PUT', url });
  }

  patch<T = unknown>(url?: string): Promise<QHttpResult<T>> {
    return this.request<T>({ method: 'PATCH', url });
  }

  delete<T = unknown>(url?: string): Promise<QHttpResult<T>> {
    return this.request<T>({ method: 'DELETE', url });
  }

  head<T = unknown>(url?: string): Promise<QHttpResult<T>> {
    return this.request<T>({ method: 'HEAD', url });
  }

  options<T = unknown>(url?: string): Promise<QHttpResult<T>> {
    return this.request<T>({ method: 'OPTIONS', url });
  }

  async request<T = unknown>(overrides: {
    method?: HttpMethod;
    url?: string;
  } = {}): Promise<QHttpResult<T>> {
    const method = overrides.method ?? this.#config.method ?? 'GET';
    const responseType = this.#config.responseType ?? 'auto';
    assertProgressCompatible(responseType, !!this.#progressHandler);

    let ctx = buildRequestContext({
      config: this.#config,
      method,
      urlOverride: overrides.url,
    });

    if (this.#config.auth) {
      applyAuth(ctx, this.#config.auth);
    }

    ctx = await this.#hooks.run('preRequest', ctx);

    const cacheEnabled = this.#isCacheEnabled(method);
    const cacheEngine = cacheEnabled ? this.#resolveCacheEngine() : undefined;
    const cacheKey = cacheEnabled ? buildCacheKey(ctx, this.#config) : undefined;
    let httpRevalidate: HttpRevalidationContext | undefined;

    if (cacheEnabled && cacheEngine && cacheKey) {
      await this.#hooks.run('preCache', ctx);
      const shouldRead = this.#config.cacheWhen?.(ctx) ?? true;
      if (shouldRead) {
        const stored = await cacheEngine.get(cacheKey);

        if (this.#isHttpCacheMode() && isHttpCacheEntry(stored)) {
          const lookup = await lookupHttpCacheEntry(stored, ctx, this.#config.httpCache);

          if (lookup.action === 'hit') {
            const cachedResult = hydrateHttpCacheResult<T>(
              lookup.entry,
              lookup.headers,
              ctx,
              this.#progressHandler,
            );
            this.#fetchStatus.set('success', { result: cachedResult });
            const payload = await this.#hooks.run('postRequest', {
              result: cachedResult,
              ctx,
            });
            return payload.result as QHttpResult<T>;
          }

          if (lookup.action === 'swr') {
            const cachedResult = hydrateHttpCacheResult<T>(
              lookup.entry,
              lookup.headers,
              ctx,
              this.#progressHandler,
            );
            void this.#runBackgroundRevalidation(ctx, cacheEngine, cacheKey, lookup);
            this.#fetchStatus.set('success', { result: cachedResult });
            const payload = await this.#hooks.run('postRequest', {
              result: cachedResult,
              ctx,
            });
            return payload.result as QHttpResult<T>;
          }

          if (lookup.action === 'revalidate') {
            applyRevalidationHeaders(ctx, lookup.revalidationHeaders);
            httpRevalidate = {
              entry: lookup.entry,
              policy: lookup.policy,
            };
          }
        } else if (!this.#isHttpCacheMode() && stored) {
          const snapshot = stored as CacheSnapshot;
          const cachedResult = this.#hydrateFromSnapshot<T>(snapshot, ctx);
          this.#fetchStatus.set('success', { result: cachedResult });
          const payload = await this.#hooks.run('postRequest', {
            result: cachedResult,
            ctx,
          });
          return payload.result as QHttpResult<T>;
        }
      }
    }

    this.#fetchStatus.set('loading');

    try {
      const result = await this.#executeRequest<T>(ctx, cacheEngine, cacheKey, httpRevalidate);
      this.#fetchStatus.set('success', { result });
      const payload = await this.#hooks.run('postRequest', { result, ctx });
      return payload.result as QHttpResult<T>;
    } catch (error) {
      const qError = this.#normalizeError(error, ctx);
      const recovered = await this.#runErrorHooks(qError);
      if (recovered) {
        this.#fetchStatus.set('success', { result: recovered });
        return recovered as QHttpResult<T>;
      }

      this.#fetchStatus.set('error', { error: qError });

      if (this.#config.throwOnError === false) {
        const failedResult: QHttpResult<T> = {
          data: undefined as T,
          httpStatus: qError.httpStatus ?? 0,
          statusText: qError.message,
          headers: {},
          ok: false,
          request: toFinalRequest(
            ctx.resolvedUrl,
            ctx.method,
            ctx.headers,
            ctx.body,
            ctx.signal,
            this.#progressHandler,
          ),
          fetchStatus: 'error',
          fromCache: false,
          error: qError,
        };
        return failedResult;
      }

      throw qError;
    }
  }

  async #executeRequest<T>(
    ctx: RequestContext,
    cacheEngine?: CacheEngine,
    cacheKey?: string,
    httpRevalidate?: HttpRevalidationContext,
  ): Promise<QHttpResult<T>> {
    const adapter = this.#config.adapter ?? defaultFetchAdapter;
    const retryOptions = withDefaults(this.#config.retry);

    const runAttempt = async (): Promise<QHttpResult<T>> => {
      const composed = composeSignal(this.#config.signal, ctx.timeout);
      this.#activeController = composed;
      ctx.signal = composed.signal;

      try {
        const finalRequest = toFinalRequest(
          ctx.resolvedUrl,
          ctx.method,
          ctx.headers,
          ctx.body,
          composed.signal,
          this.#progressHandler,
        );

        let rawResponse: Awaited<ReturnType<HttpAdapter['send']>>;
        try {
          rawResponse = await adapter.send(finalRequest);
        } catch (cause) {
          throw this.#createTransportError(cause, composed, ctx, finalRequest);
        }

        const headers = recordToHeaders(rawResponse.headers);
        let bufferedBody: ArrayBuffer | null | undefined;

        if (this.#progressHandler && rawResponse.body) {
          bufferedBody = await readResponseWithProgress(rawResponse, this.#progressHandler);
        }

        if (httpRevalidate && rawResponse.status === 304) {
          const revalidated = await processRevalidationResponse(httpRevalidate, ctx, {
            data: httpRevalidate.entry.data,
            httpStatus: rawResponse.status,
            statusText: rawResponse.statusText,
            headers,
          });

          const result: QHttpResult<T> = {
            data: revalidated.data as T,
            httpStatus: revalidated.httpStatus,
            statusText: revalidated.statusText,
            headers: revalidated.headers,
            ok: revalidated.httpStatus >= 200 && revalidated.httpStatus < 300,
            request: finalRequest,
            fetchStatus: 'success',
            fromCache: revalidated.fromCache,
          };

          if (cacheEngine && cacheKey && revalidated.ttlMs > 0) {
            await this.#hooks.run('postCache', { result, ctx });
            await cacheEngine.set(cacheKey, revalidated.entry);
          }

          return result;
        }

        const data = await parseResponseBody<T>(
          rawResponse,
          ctx.responseType,
          bufferedBody,
        );

        const result: QHttpResult<T> = {
          data,
          httpStatus: rawResponse.status,
          statusText: rawResponse.statusText,
          headers,
          ok: rawResponse.ok,
          request: finalRequest,
          fetchStatus: 'success',
          fromCache: false,
        };

        const validate = this.#config.validateStatus ?? ((s) => s >= 200 && s < 300);
        if (!validate(rawResponse.status)) {
          throw new QHttpError(`Request failed with status ${rawResponse.status}`, {
            code: 'HTTP_ERROR',
            httpStatus: rawResponse.status,
            request: contextToConfig(ctx),
            result,
          });
        }

        if (cacheEngine && cacheKey && this.#isCacheEnabled(ctx.method)) {
          const shouldWrite = this.#config.cacheWhen?.(ctx, result) ?? true;
          if (shouldWrite && this.#canCacheResult(result, ctx.responseType)) {
            await this.#hooks.run('postCache', { result, ctx });

            if (this.#isHttpCacheMode()) {
              if (httpRevalidate) {
                const revalidated = await processRevalidationResponse(httpRevalidate, ctx, result);
                if (revalidated.ttlMs > 0) {
                  await cacheEngine.set(cacheKey, revalidated.entry);
                }
                return {
                  ...result,
                  data: revalidated.data as T,
                  httpStatus: revalidated.httpStatus,
                  statusText: revalidated.statusText,
                  headers: revalidated.headers,
                  ok: revalidated.httpStatus >= 200 && revalidated.httpStatus < 300,
                  fromCache: revalidated.fromCache,
                };
              }

              const stored = await createHttpCacheEntry(ctx, result, this.#config.httpCache);
              if (stored) {
                await cacheEngine.set(cacheKey, stored.entry);
              }
            } else {
              const snapshot: CacheSnapshot = {
                data: result.data,
                httpStatus: result.httpStatus,
                statusText: result.statusText,
                headers: result.headers,
              };
              await cacheEngine.set(cacheKey, snapshot, this.#config.cacheTTL);
            }
          }
        }

        return result;
      } finally {
        composed.cleanup();
        this.#activeController = undefined;
      }
    };

    if (retryOptions) {
      if (!isReplayableBody(ctx.body)) {
        return runAttempt();
      }

      return withRetry(runAttempt, {
        ...retryOptions,
        method: ctx.method,
        signal: this.#config.signal,
        onRetry: async (attempt, error) => {
          await this.#hooks.run('onRetry', { attempt, error });
        },
      });
    }

    return runAttempt();
  }

  #isHttpCacheMode(): boolean {
    return this.#config.cacheMode === 'http';
  }

  async #runBackgroundRevalidation(
    ctx: RequestContext,
    cacheEngine: CacheEngine,
    cacheKey: string,
    lookup: Extract<Awaited<ReturnType<typeof lookupHttpCacheEntry>>, { action: 'swr' }>,
  ): Promise<void> {
    try {
      const revalidationCtx: RequestContext = {
        ...ctx,
        headers: new Map(ctx.headers),
      };
      applyRevalidationHeaders(revalidationCtx, lookup.revalidationHeaders);

      const result = await this.#executeRequest(
        revalidationCtx,
        cacheEngine,
        cacheKey,
        {
          entry: lookup.entry,
          policy: lookup.policy,
        },
      );

      if (this.#config.cacheWhen?.(revalidationCtx, result) === false) {
        return;
      }
    } catch {
      // Background revalidation failures must not affect the caller.
    }
  }

  #isCacheEnabled(method: HttpMethod): boolean {
    if (!this.#config.cache) return false;
    const methods = this.#config.cacheMethods ?? DEFAULT_CACHE_METHODS;
    return methods.includes(method);
  }

  #resolveCacheEngine(): CacheEngine | undefined {
    if (this.#config.cacheEngine) {
      return this.#config.cacheEngine;
    }
    if (this.#config.cache) {
      return getDefaultCacheEngine();
    }
    return undefined;
  }

  #hydrateFromSnapshot<T>(snapshot: CacheSnapshot, ctx: RequestContext): QHttpResult<T> {
    return {
      data: snapshot.data as T,
      httpStatus: snapshot.httpStatus,
      statusText: snapshot.statusText,
      headers: snapshot.headers,
      ok: snapshot.httpStatus >= 200 && snapshot.httpStatus < 300,
      request: toFinalRequest(
        ctx.resolvedUrl,
        ctx.method,
        ctx.headers,
        ctx.body,
        ctx.signal,
        this.#progressHandler,
      ),
      fetchStatus: 'success',
      fromCache: true,
    };
  }

  #canCacheResult(_result: QHttpResult, responseType: ResponseType): boolean {
    if (isBinaryResponseType(responseType)) {
      const engine = this.#resolveCacheEngine();
      if (engine instanceof LocalStorageCacheEngine) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[qhttp] Skipping localStorage cache for binary response');
        }
        return false;
      }
    }
    return true;
  }

  async #runErrorHooks(error: QHttpError): Promise<QHttpResult | undefined> {
    const recovered = await this.#hooks.runErrorHooks(error);
    if (recovered && typeof recovered === 'object' && 'data' in recovered) {
      return recovered as QHttpResult;
    }
    return undefined;
  }

  #normalizeError(error: unknown, ctx: RequestContext): QHttpError {
    if (isQHttpError(error)) return error;
    if (isAbortError(error)) {
      const reason = this.#activeController?.reason ?? 'ABORTED';
      return new QHttpError(reason === 'TIMEOUT' ? 'Request timed out' : 'Request aborted', {
        code: reason,
        request: contextToConfig(ctx),
        cause: error,
      });
    }
    return new QHttpError('Network request failed', {
      code: 'NETWORK',
      request: contextToConfig(ctx),
      cause: error,
    });
  }

  #createTransportError(
    cause: unknown,
    composed: ComposedSignal,
    ctx: RequestContext,
    _request: FinalRequest,
  ): QHttpError {
    if (isAbortError(cause)) {
      const reason = composed.reason ?? 'ABORTED';
      return new QHttpError(reason === 'TIMEOUT' ? 'Request timed out' : 'Request aborted', {
        code: reason,
        request: contextToConfig(ctx),
        cause,
      });
    }
    return new QHttpError('Network request failed', {
      code: 'NETWORK',
      request: contextToConfig(ctx),
      cause,
    });
  }
}
