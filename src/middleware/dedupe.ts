import { buildCacheKeyFromContext } from '../core/build-request.js';
import { timingFor } from '../core/result.js';
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
 * Followers receive a shallow copy carrying their own requestId and timing.
 */
export function createDedupeMiddleware(deps: DedupeMiddlewareDeps): Middleware {
  return (ctx, next) => {
    if (!deps.enabled || !SAFE_METHODS.has(ctx.method)) return next();

    const key = ctx.state.cacheKey ?? buildCacheKeyFromContext(ctx, { vary: deps.vary });
    const existing = deps.inflight.get(key);
    if (existing) {
      return existing.then((result) => ({
        ...result,
        headers: { ...result.headers },
        requestId: ctx.requestId,
        timing: timingFor(ctx),
      }));
    }

    const pending = next().finally(() => {
      if (deps.inflight.get(key) === pending) deps.inflight.delete(key);
    });
    deps.inflight.set(key, pending);
    return pending;
  };
}
