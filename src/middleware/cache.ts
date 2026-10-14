import { buildCacheKey } from '../cache/cache-key.js';
import { getDefaultCacheEngine } from '../cache/default-cache-engine.js';
import { LocalStorageCacheEngine } from '../cache/local-storage-cache-engine.js';
import {
  applyRevalidationHeaders,
  createHttpCacheEntry,
  hydrateHttpCacheResult,
  isHttpCacheEntry,
  lookupHttpCacheEntry,
  processRevalidationResponse,
  type HttpCacheLookup,
  type HttpRevalidationContext,
} from '../cache/http-cache-policy.js';
import { isBinaryResponseType, toRequestSummary } from '../core/body.js';
import { makeResult } from '../core/result.js';
import type {
  CacheEngine,
  CacheSnapshot,
  HttpMethod,
  Middleware,
  QHttpConfig,
  QHttpResult,
  RequestContext,
  RequestOptions,
} from '../core/types.js';
import type { HookManager } from '../interceptors/hook-manager.js';
import { warnDev } from '../utils/env.js';
import { createRequestId } from '../utils/hash.js';

export const DEFAULT_CACHE_METHODS: HttpMethod[] = ['GET', 'HEAD'];
/** TTL applied by `.cache()` when none is configured. */
export const DEFAULT_CACHE_TTL_MS = 5 * 60_000;
/** Stale HTTP entries are retained this long past freshness for revalidation. */
export const DEFAULT_STALE_RETENTION_MS = 24 * 60 * 60_000;

export interface CacheMiddlewareDeps {
  config: QHttpConfig;
  options: RequestOptions;
  hooks: HookManager;
}

function isCacheSnapshot(value: unknown): value is CacheSnapshot {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as CacheSnapshot).httpStatus === 'number' &&
    'data' in (value as object)
  );
}

async function safeGet(engine: CacheEngine, key: string): Promise<unknown> {
  try {
    return await engine.get(key);
  } catch (error) {
    warnDev(`cache read failed for ${key}: ${String(error)}`);
    return undefined;
  }
}

async function safeSet(engine: CacheEngine, key: string, value: unknown, ttl?: number) {
  try {
    await engine.set(key, value, ttl);
  } catch (error) {
    warnDev(`cache write failed for ${key}: ${String(error)}`);
  }
}

function hydrateSnapshot<T>(snapshot: CacheSnapshot, ctx: RequestContext): QHttpResult<T> {
  return makeResult<T>(ctx, {
    data: snapshot.data as T,
    httpStatus: snapshot.httpStatus,
    statusText: snapshot.statusText,
    headers: snapshot.headers,
    request: toRequestSummary({
      url: ctx.resolvedUrl,
      method: ctx.method,
      headers: ctx.headers,
      signal: ctx.signal,
      init: ctx.fetchOptions,
    }),
    fromCache: true,
  });
}

/** TTL key/value cache and RFC 9111 HTTP cache (hit, SWR, conditional revalidation). */
export function createCacheMiddleware(deps: CacheMiddlewareDeps): Middleware {
  const { config, options, hooks } = deps;
  const httpMode = config.cacheMode === 'http';

  const enabledFor = (method: HttpMethod): boolean => {
    const enabled = options.cache ?? config.cache;
    if (!enabled) return false;
    return (config.cacheMethods ?? DEFAULT_CACHE_METHODS).includes(method);
  };

  const resolveEngine = (): CacheEngine => config.cacheEngine ?? getDefaultCacheEngine();

  const httpEntryTtl = (freshMs: number): number =>
    freshMs + (config.httpCache?.staleRetentionMs ?? DEFAULT_STALE_RETENTION_MS);

  const canCache = (ctx: RequestContext, engine: CacheEngine): boolean => {
    if (isBinaryResponseType(ctx.responseType) && engine instanceof LocalStorageCacheEngine) {
      warnDev('Skipping localStorage cache for binary response');
      return false;
    }
    return true;
  };

  const store = async (
    ctx: RequestContext,
    engine: CacheEngine,
    key: string,
    result: QHttpResult,
    revalidate?: HttpRevalidationContext,
  ): Promise<QHttpResult> => {
    if (httpMode && revalidate) {
      const revalidated = await processRevalidationResponse(revalidate, ctx, {
        data: result.httpStatus === 304 ? revalidate.entry.data : result.data,
        httpStatus: result.httpStatus,
        statusText: result.statusText,
        headers: result.headers,
      });
      const merged: QHttpResult = {
        ...result,
        data: revalidated.data,
        httpStatus: revalidated.httpStatus,
        statusText: revalidated.statusText,
        headers: revalidated.headers,
        ok: revalidated.httpStatus >= 200 && revalidated.httpStatus < 300,
        fromCache: revalidated.fromCache,
      };
      if (revalidated.ttlMs > 0 && (config.cacheWhen?.(ctx, merged) ?? true)) {
        await hooks.run('postCache', { result: merged, ctx });
        await safeSet(engine, key, revalidated.entry, httpEntryTtl(revalidated.ttlMs));
      }
      return merged;
    }

    const shouldWrite = config.cacheWhen?.(ctx, result) ?? true;
    if (!shouldWrite || !canCache(ctx, engine)) return result;

    await hooks.run('postCache', { result, ctx });

    if (httpMode) {
      const stored = await createHttpCacheEntry(ctx, result, config.httpCache);
      if (stored) {
        await safeSet(engine, key, stored.entry, httpEntryTtl(stored.ttlMs));
      }
      return result;
    }

    const snapshot: CacheSnapshot = {
      data: result.data,
      httpStatus: result.httpStatus,
      statusText: result.statusText,
      headers: result.headers,
    };
    await safeSet(engine, key, snapshot, options.cacheTTL ?? config.cacheTTL ?? DEFAULT_CACHE_TTL_MS);
    return result;
  };

  return async (ctx, next) => {
    if (!enabledFor(ctx.method)) return next();

    const engine = resolveEngine();
    const key = buildCacheKey(ctx, {
      cacheKey: options.cacheKey ?? config.cacheKey,
      paramsSerializer: config.paramsSerializer,
      cacheVary: config.cacheVary,
    });
    ctx.state.cacheKey = key;

    await hooks.run('preCache', ctx);
    const shouldRead = config.cacheWhen?.(ctx) ?? true;
    let revalidate: HttpRevalidationContext | undefined;

    if (shouldRead) {
      const stored = await safeGet(engine, key);

      if (httpMode && isHttpCacheEntry(stored)) {
        const lookup = await lookupHttpCacheEntry(stored, ctx, config.httpCache);

        if (lookup.action === 'hit') {
          return hydrateHttpCacheResult(lookup.entry, lookup.headers, ctx);
        }

        if (lookup.action === 'swr') {
          void revalidateInBackground(ctx, engine, key, lookup, next, store);
          return hydrateHttpCacheResult(lookup.entry, lookup.headers, ctx);
        }

        if (lookup.action === 'revalidate') {
          applyRevalidationHeaders(ctx, lookup.revalidationHeaders);
          revalidate = { entry: lookup.entry, policy: lookup.policy };
          ctx.state.httpRevalidate = revalidate;
        }
      } else if (!httpMode && isCacheSnapshot(stored)) {
        return hydrateSnapshot(stored, ctx);
      }
    }

    const result = await next(ctx);
    return store(ctx, engine, key, result, revalidate);
  };
}

async function revalidateInBackground(
  ctx: RequestContext,
  engine: CacheEngine,
  key: string,
  lookup: Extract<HttpCacheLookup, { action: 'swr' }>,
  next: (ctx: RequestContext) => Promise<QHttpResult>,
  store: (
    ctx: RequestContext,
    engine: CacheEngine,
    key: string,
    result: QHttpResult,
    revalidate?: HttpRevalidationContext,
  ) => Promise<QHttpResult>,
): Promise<void> {
  const revalidate: HttpRevalidationContext = { entry: lookup.entry, policy: lookup.policy };
  const background: RequestContext = {
    ...ctx,
    requestId: createRequestId(),
    startedAt: Date.now(),
    headers: new Map(ctx.headers),
    // Background work must survive the caller cancelling its own request.
    signal: undefined,
    onProgress: undefined,
    state: { attempt: 0, httpRevalidate: revalidate, cacheKey: key },
  };
  applyRevalidationHeaders(background, lookup.revalidationHeaders);

  try {
    const result = await next(background);
    await store(background, engine, key, result, revalidate);
  } catch {
    // Background revalidation failures must not affect the caller.
  }
}
