# Caching

QHttp provides two opt-in cache modes on the same `CacheEngine` backends:

| Mode | API | Behavior |
|------|-----|----------|
| **TTL** (default) | `.cache()` | Fast key/value store; client-controlled TTL |
| **HTTP** (RFC 9111) | `.httpCache()` | `Cache-Control`, freshness, `Vary`, validators, conditional revalidation |

Use `.cache()` when you want maximum speed and simple invalidation. Use `.httpCache()` when responses carry standard HTTP cache headers.

## TTL cache

```typescript
import { QHttp, MemoryCacheEngine } from '@questorylabs/qhttp';

const cache = new MemoryCacheEngine();

const client = new QHttp({ baseUrl: 'https://api.example.com' })
  .cache()                    // enable TTL mode
  .cacheTTL(60_000)           // default TTL: 60s
  .cacheEngine(cache)         // optional: shared engine
  .cacheKey('users:{{userId}}')
  .replaceUrlMacros({ userId: 'u1' });

const first = await client.get('/users/u1');
const second = await client.get('/users/u1');

first.fromCache;  // false — network
second.fromCache; // true  — cache hit
```

## HTTP cache (RFC 9111)

Requires the optional peer `http-cache-semantics`:

```bash
pnpm add http-cache-semantics
```

```typescript
const client = new QHttp({ baseUrl: 'https://api.example.com' })
  .httpCache({ shared: false }) // private user-agent cache (default)
  .cacheEngine(cache);

const first = await client.get('/users/u1');
const second = await client.get('/users/u1');
```

HTTP mode interprets response headers (`Cache-Control`, `ETag`, `Last-Modified`, `Vary`, etc.) and:

- Returns fresh responses from cache without network I/O
- Sends conditional revalidation (`If-None-Match` / `If-Modified-Since`) when stale
- Reuses cached bodies on `304 Not Modified`
- Supports `stale-while-revalidate` (returns stale immediately, refreshes in background)

`cacheTTL` is ignored in HTTP mode — freshness is driven by response headers and stored `CachePolicy` metadata.

### Shared vs private cache

```typescript
client.httpCache({ shared: false }); // default — `Cache-Control: private` is storable
client.httpCache({ shared: true });  // proxy-style — `private` responses are not stored
```

### Vary caveat

One cache key maps to one stored variant. `Vary` is enforced on read — a request whose headers do not match the cached variant misses and may overwrite the prior entry. Use explicit `.cacheKey()` when caching multiple representations of the same URL.

### Policy helpers

Low-level helpers are exported from `@questorylabs/qhttp/http-cache` for custom integrations.

By default only `GET` and `HEAD` are cached. Customize:

```typescript
client.cacheMethods(['GET', 'HEAD', 'OPTIONS']);
```

## Default cache engine

When you call `.cache()` without `.cacheEngine()`, QHttp picks:

| Runtime | Engine |
|---------|--------|
| Browser (with `localStorage`) | `LocalStorageCacheEngine` |
| Node / edge | `MemoryCacheEngine` |

Configure the global default:

```typescript
import { configureDefaultCacheEngine, MemoryCacheEngine } from '@questorylabs/qhttp';

configureDefaultCacheEngine(new MemoryCacheEngine());
```

## Cache keys

Three strategies:

### 1. Explicit string (with macro support)

```typescript
client.cacheKey('orders:{{userId}}:page-{{page}}');
```

### 2. Function

```typescript
client.cacheKey((ctx) => `${ctx.method}:${ctx.resolvedUrl}`);
```

### 3. Automatic (default when no `cacheKey` set)

Derived from method, resolved URL, sorted query params, and body keys — see `buildCacheKeyFromContext`.

```typescript
import { buildCacheKey, buildCacheKeyFromContext } from '@questorylabs/qhttp';
```

## Conditional caching

Gate reads and writes:

```typescript
client.cacheWhen((ctx, result) => {
  // Skip read from cache for ?refresh=1
  if (ctx.queryParams.refresh) return false;
  // Only write successful responses
  if (result && !result.ok) return false;
  return true;
});
```

`cacheWhen` is evaluated for reads (no `result`) and writes (with `result`).

## Static cache API

Manage the default engine without a client:

```typescript
await QHttp.setCache('orders:u2', snapshot, 60_000);
const value = await QHttp.getCache('orders:u2');
await QHttp.deleteCache('orders:u2');
await QHttp.deleteCacheByPrefix('orders:');
await QHttp.clearCache();

// Also on the class:
QHttp.configureDefaultCacheEngine(engine);
```

Use this to pre-warm cache or invalidate after mutations:

```typescript
await client.post('/orders').setBody({ item: 'x' });
await QHttp.deleteCacheByPrefix('orders:');
```

## Custom CacheEngine

Implement the interface for Redis, SQLite, etc.:

```typescript
import type { CacheEngine } from '@questorylabs/qhttp';

const engine: CacheEngine = {
  async get(key) { /* ... */ },
  async set(key, value, ttlMs) { /* ... */ },
  async delete(key) { /* ... */ },
  async clear() { /* ... */ },
  async deleteByPrefix(prefix) { /* ... */ }, // optional
};
```

Stored values are `CacheSnapshot` objects:

```typescript
interface CacheSnapshot {
  data: unknown;
  httpStatus: number;
  statusText: string;
  headers: Record<string, string>;
}
```

## Cache hooks

```typescript
client.hook('preCache', (ctx) => { /* before read */ });
client.hook('postCache', ({ result, ctx }) => { /* after write */ });
```

## Guidelines

1. **Share one engine** across clients when you want a global cache (e.g. one `MemoryCacheEngine` per process).
2. **Set explicit keys** for macro-heavy URLs — easier to invalidate than auto keys.
3. **Binary responses** skip `localStorage` caching (not safely serializable) — use `MemoryCacheEngine` for blobs.
4. **Serverless** — in-memory cache does not survive cold starts; use an external engine or accept miss-on-cold-start.
5. **TTL is per entry** — `cacheTTL` on the client applies when writing; static `setCache` accepts TTL per call.

## Performance note

Cache hits avoid network and parsing entirely — useful for hot paths and UI refreshes that repeat the same GET.
