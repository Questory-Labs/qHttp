export {
  applyRevalidationHeaders,
  buildPolicyRequest,
  buildPolicyResponse,
  createHttpCacheEntry,
  hydrateHttpCacheResult,
  isHttpCacheEntry,
  loadHttpCacheSemantics,
  lookupHttpCacheEntry,
  processRevalidationResponse,
  resetHttpCacheSemanticsForTests,
} from './cache/http-cache-policy.js';
export type {
  HttpCacheLookup,
  HttpRevalidationContext,
  RevalidatedHttpCacheResult,
} from './cache/http-cache-policy.js';
export type { HttpCacheEntry, HttpCacheOptions, CacheMode } from './core/types.js';
