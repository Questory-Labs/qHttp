# Caching

Two opt-in cache modes on the same `CacheEngine` backends:

| Mode | API | Behaviour |
|------|-----|-----------|
| **TTL** (default) | `.cache()` | Key/value store; client-controlled TTL (5 min default) |
| **HTTP** (RFC 9111) | `.httpCache()` | `Cache-Control`, freshness, `Vary`, validators, conditional revalidation, SWR |

## TTL cache

```typescript
import { QHttp, MemoryCacheEngine } from '@questorylabs/qhttp';

const client = new QHttp({ baseUrl: 'https://api.example.com' })
  .cache()
  .cacheTTL(60_000)
  .cacheEngine(new MemoryCacheEngine({ maxSize: 1_000 }));

const first = await client.get('/users/u1');   // network
const second = await client.get('/users/u1');  // fromCache: true

await client.get('/users/u1', { cache: false });          // bypass for one call
await client.get('/reports', { cacheTTL: 5 * 60_000 });   // per-call TTL
```

Without `cacheTTL`, entries expire after `DEFAULT_CACHE_TTL_MS` (5 minutes). Pass `Infinity` for no expiry.

## HTTP cache (RFC 9111)

Requires the optional peer `http-cache-semantics`.

```typescript
const client = new QHttp({ baseUrl }).httpCache({ shared: false }).cacheEngine(cache);
```

HTTP mode reads `Cache-Control`, `ETag`, `Last-Modified`, `Vary` and more, and:

- returns fresh responses without network I/O
- sends `If-None-Match` / `If-Modified-Since` when stale and reuses the body on `304`
- serves stale immediately during `stale-while-revalidate` and refreshes in the background
- keeps stale entries for `staleRetentionMs` (24h default) past freshness so they can still be revalidated

`cacheTTL` is ignored in HTTP mode. Options: `shared`, `cacheHeuristic`, `immutableMinTimeToLive`, `ignoreCargoCult`, `staleRetentionMs`.

One cache key maps to one stored variant; use explicit `.cacheKey()` when caching several `Vary` representations of one URL.

## Cache keys

Automatic keys are `METHOD:url?sortedParams:body#vary`. Headers listed in `cacheVary` (default `['authorization']`) are **hashed into the key**, so authenticated responses never cross users that share one engine.

```typescript
client.cacheVary(['authorization', 'accept-language']);
client.cacheKey('orders:{{userId}}:page-{{page}}');            // explicit, macro-aware
client.cacheKey((ctx) => `${ctx.method}:${ctx.resolvedUrl}`);  // function
await client.get('/x', { cacheKey: 'x:one-off' });              // per call
```

Explicit keys bypass the vary hash; include the user in them yourself.

## Default engine

`MemoryCacheEngine` in every runtime. Persistence across page loads is opt-in:

```typescript
import { configureDefaultCacheEngine, LocalStorageCacheEngine } from '@questorylabs/qhttp';
configureDefaultCacheEngine(new LocalStorageCacheEngine('myapp:'));
```

Engine failures (quota, network to Redis, corrupt entries) are logged in development and never fail the request.

## Conditional caching

```typescript
client.cacheWhen((ctx, result) => {
  if (ctx.queryParams.refresh) return false;   // read gate (no result)
  if (result && !result.ok) return false;      // write gate
  return true;
});
client.cacheMethods(['GET', 'HEAD', 'OPTIONS']);
```

## Invalidation

```typescript
await QHttp.deleteCacheByPrefix('GET:https://api.example.com/orders');
await QHttp.deleteCache(key);
await QHttp.clearCache();
await QHttp.setCache('warm:key', snapshot, 60_000);
```

## Custom engine

```typescript
import type { CacheEngine } from '@questorylabs/qhttp';

const redisEngine: CacheEngine = {
  async get(key) { return JSON.parse((await redis.get(key)) ?? 'null') ?? undefined; },
  async set(key, value, ttlMs) { await redis.set(key, JSON.stringify(value), ttlMs ? { PX: ttlMs } : {}); },
  async delete(key) { await redis.del(key); },
  async clear() { /* flush namespace */ },
  async deleteByPrefix(prefix) { /* SCAN + DEL */ },
};
```

TTL mode stores `CacheSnapshot` objects (`data`, `httpStatus`, `statusText`, `headers`); HTTP mode stores `HttpCacheEntry` objects with the serialized policy.

## Cache hooks

```typescript
client.hook('preCache', (ctx) => { /* before read; ctx.state.cacheKey is set */ });
client.hook('postCache', ({ result, ctx }) => { /* before write */ });
```

## Guidelines

1. **Share one engine** per process for a global cache; pass the instance to each client.
2. **Keep `authorization` in `cacheVary`** unless the engine is per-user already.
3. **Binary responses** skip `localStorage`; use memory or a custom engine for blobs.
4. **Serverless**: in-memory caches do not survive cold starts.
5. **Pair with `dedupe()`** to collapse concurrent misses into one request.
