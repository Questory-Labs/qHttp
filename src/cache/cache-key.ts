import type { QHttpConfig, RequestContext } from '../core/types.js';
import { buildCacheKeyFromContext } from '../core/build-request.js';
import { resolveMacros } from '../utils/url-macros.js';

export function buildCacheKey(
  ctx: RequestContext,
  config: Pick<QHttpConfig, 'cacheKey' | 'paramsSerializer'>,
): string {
  if (typeof config.cacheKey === 'function') {
    return config.cacheKey(ctx);
  }

  if (typeof config.cacheKey === 'string') {
    return resolveMacros(config.cacheKey, ctx.macros, { strict: true });
  }

  return buildCacheKeyFromContext(ctx, config.paramsSerializer);
}

export { buildCacheKeyFromContext };
