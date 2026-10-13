import { buildCacheKeyFromContext } from '../core/build-request.js';
import type { HttpMethod, Middleware, QHttpResult } from '../core/types.js';

const SAFE_METHODS = new Set<HttpMethod>(['GET', 'HEAD', 'OPTIONS']);

export interface DedupeMiddlewareDeps {
  enabled: boolean;
  /** Shared across a client (and its clones). */
  inflight: Map<string, Promise<QHttpResult>>;
  vary?: string[];
}

/**
 * Share one in-flight response between identical concurrent safe requests.
 * Followers receive the leader's result object.
 */
export function createDedupeMiddleware(deps: DedupeMiddlewareDeps): Middleware {
  return (ctx, next) => {
    if (!deps.enabled || !SAFE_METHODS.has(ctx.method)) return next();

    const key = ctx.state.cacheKey ?? buildCacheKeyFromContext(ctx, { vary: deps.vary });
    const existing = deps.inflight.get(key);
    if (existing) return existing;

    const pending = next().finally(() => {
      if (deps.inflight.get(key) === pending) deps.inflight.delete(key);
    });
    deps.inflight.set(key, pending);
    return pending;
  };
}
