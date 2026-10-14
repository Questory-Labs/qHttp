# API reference

Quick lookup. For narrative guides see the other docs.

## QHttp

```typescript
new QHttp(config?: QHttpConfig)
```

### QHttpConfig

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `baseUrl` | `string` | — | Base for relative paths |
| `url` | `string` | — | Default path (`{{macros}}` allowed) |
| `method` | `HttpMethod` | `'GET'` | Default method for `request()` |
| `headers` | `HeadersInit` | — | Default headers |
| `queryParams` | `QueryParams` | — | Default query |
| `body` | `RequestBody` | — | Default body |
| `timeout` | `number` | — | Per-attempt timeout ms |
| `deadline` | `number` | — | Whole-request budget ms |
| `responseType` | `ResponseType` | `'auto'` | Parsing |
| `adapter` | `HttpAdapter` | fetch | Transport |
| `retry` | `RetryOptions` | — | Retry policy |
| `cache` / `cacheMode` / `cacheTTL` / `cacheEngine` / `cacheKey` / `cacheWhen` / `cacheMethods` / `cacheVary` / `httpCache` | | | See [Caching](./caching.md) |
| `auth` | `AuthConfig` | — | Bearer / basic / custom |
| `signal` | `AbortSignal` | — | External abort |
| `throwOnError` | `boolean` | `true` | Throw vs failed result |
| `validateStatus` | `fn` | 2xx | Success predicate |
| `paramsSerializer` | `fn` | — | Custom query string |
| `urlMacros` | `record` | — | Macro values |
| `fetchOptions` | `FetchOptions` | — | Fetch init passthrough |
| `parse` | `ResponseParser` | — | Schema or transform |
| `dedupe` | `boolean` | `false` | Share identical in-flight safe requests |
| `rateLimit` | `RateLimitOptions \| RateLimiter` | — | Per-origin pacing |
| `circuitBreaker` | `CircuitBreakerOptions \| CircuitBreaker` | — | Fail fast per origin |
| `meta` | `record` | — | Available as `ctx.meta` |

### RequestOptions (per call)

`url`, `method` (via `request`), `params`, `headers`, `body`, `macros`, `timeout`, `deadline`, `responseType`, `signal`, `retry` (`RetryOptions | false`), `cache`, `cacheTTL`, `cacheKey`, `auth` (`AuthConfig | false`), `throwOnError`, `validateStatus`, `fetchOptions`, `parse`, `dedupe`, `onProgress`, `meta`.

### Setters

| Method | Description |
|--------|-------------|
| `setBaseUrl`, `setUrl`, `replaceUrlMacros`, `setQueryParams`, `paramsSerializer`, `setHeaders`, `setBody` | Request defaults |
| `setTimeout(ms)`, `setDeadline(ms)` | Time limits |
| `setResponseType`, `parse(parser)` | Parsing |
| `setRetry`, `rateLimit`, `circuitBreaker`, `dedupe` | Resilience |
| `cache`, `httpCache`, `cacheTTL`, `cacheEngine`, `cacheKey`, `cacheWhen`, `cacheMethods`, `cacheVary`, `getCacheEngine` | Cache |
| `setAuth`, `setSignal`, `setAdapter`, `setFetchOptions`, `setMeta` | Transport |
| `validateStatus`, `throwOnError` | Status policy |
| `onProgress`, `onStateChange` | Callbacks |

### Hooks and middleware

`preRequest`, `postRequest`, `onError`, `onRetry`, `hook(phase, fn)`, `use(middleware)`.

### Execution

| Method | Description |
|--------|-------------|
| `get/post/put/patch/delete/head/options(url?, options?)` | Verb helpers |
| `request({ method?, url?, ...options })` | Generic |
| `paginate({ next, maxPages?, ...options })` | Async iterable with `.items(select)` and `.all()` |
| `cancel()` | Abort all in-flight |
| `reset()` | fetchStatus → idle |
| `clone()` | Copy config, hooks, middleware |

### Properties

`fetchStatus`, `inFlight`, `config` (read-only).

### Statics

`configureDefaultCacheEngine`, `getCache`, `setCache`, `deleteCache`, `deleteCacheByPrefix`, `clearCache`.

## QHttpResult

```typescript
interface QHttpResult<T> {
  data: T;
  httpStatus: number;
  statusText: string;
  headers: Record<string, string>;
  ok: boolean;
  response?: Response;
  request: FinalRequest;
  fetchStatus: FetchStatus;
  fromCache: boolean;
  error?: QHttpError;
  requestId: string;
  timing: { startedAt: number; endedAt: number; durationMs: number; attempts: number };
}
```

## QHttpError

`code`, `httpStatus` (`status` alias), `data`, `result`, `request` (redacted), `requestId`, `issues`, `cause`, `toJSON()`.

## Types

```typescript
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
type ResponseType = 'auto' | 'json' | 'text' | 'blob' | 'arrayBuffer' | 'stream';
type FetchStatus = 'idle' | 'loading' | 'success' | 'error';
type Middleware = (ctx: RequestContext, next: Next) => Promise<QHttpResult>;
type Next = (ctx?: RequestContext) => Promise<QHttpResult>;

type AuthConfig =
  | { type: 'bearer'; token: string | (() => string | Promise<string>); refresh?: AuthRefreshOptions }
  | { type: 'basic'; username: string; password: string }
  | { type: 'custom'; apply: (ctx) => void | Promise<void>; refresh?: AuthRefreshOptions };

interface RetryOptions { retries?; backoff?; retryDelay?; maxDelay?; jitter?; retryOn? }
interface RateLimitOptions { requestsPerSecond?; burst?; concurrency? }
interface CircuitBreakerOptions { failureThreshold?; resetAfterMs?; isFailure? }
type ResponseParser<T> = StandardSchema<T> | ((data: unknown) => T | Promise<T>);
```

## Pagination helpers

`pageParam({ param?, start?, hasMore })`, `cursorParam({ param?, getCursor })`, `linkHeader()`, `parseNextLink(header)`, `createPaginator(request, options)`.

## Utilities

`compose`, `joinUrl`, `isAbsoluteUrl`, `resolveMacros`, `findUnresolvedMacros`, `serializeParams`, `buildCacheKey`, `buildCacheKeyFromContext`, `stableStringify`, `fnv1a`, `redactHeaders`, `applyAuth`, `createAuthPreRequestHook`, `resolveToken`, `toBase64`, `wrapFetchResponse`, `HookManager`, `MemoryCacheEngine`, `LocalStorageCacheEngine`, `RateLimiter`, `CircuitBreaker`, `DEFAULT_CACHE_TTL_MS`.

## QWebSocket (`/ws`)

`setProtocols`, `setHeaders`, `setAdapter`, `setReconnect({ retries, delay, backoff, maxDelay, jitter })`, `setHeartbeat({ intervalMs, message, pongTimeoutMs, isPong })`, `on/off`, `onOpen`, `onMessage`, `onJson`, `onError`, `onClose`, `onReconnect`, `onReconnected`, `onStateChange`, `connect`, `send`, `sendJson`, `close`, `readyState`, `bufferedAmount`, `queuedCount`. Adapters: `BrowserWSAdapter`, `NodeWSAdapter`.

## QEventSource (`/sse`)

`new QEventSource(url, { headers, fetchOptions, method, body, reconnect, lastEventId, fetch, signal })`, `on/off`, `onOpen`, `onMessage`, `onEvent(name)`, `onJson(fn, event?)`, `onError`, `onClose`, `onReconnect`, `onStateChange`, `connect`, `close`, `readyState`, `lastEventId`, async iteration. Also `subscribeSse(url, handlers, signal)`, `createSseParser`, `SseHttpError`.

## ResourceStore (`/resource`, `/react`)

`ensure`, `reload`, `push`, `update`, `touch`, `drop`, `peek`, `snapshot`, `has`, `observe`, `subscribe`, `getAllIds`, `dehydrate`, `hydrate`, `configureDefaults`, `getDefaults`.

## React (`/react`)

`ResourceProvider({ store?, defaults?, hydrate? })`, `useStore`, `useResource`, `useAction`, `useLiveResource`, `useSuspenseResource`, `usePagedResource`, `RefreshScheduler`, `shouldRefreshOnFocus`, `loadFromRequest`.

## Testing (`/testing`)

`MockAdapter({ unmatched? })` with `on`, `once`, `get`, `post`, `put`, `patch`, `delete`, `reset`, `calls`, `callsTo`; `mockResponse(body?, init?)`.

## HTTP/2 (`/http2`)

`Http2Adapter({ sessionIdleMs?, connectOptions? })`, `serializeHttp2Body`, `filterHttp2Headers`.

## HTTP cache (`/http-cache`)

Policy helpers over `http-cache-semantics`: `createHttpCacheEntry`, `lookupHttpCacheEntry`, `processRevalidationResponse`, `applyRevalidationHeaders`, `hydrateHttpCacheResult`, `isHttpCacheEntry`, `loadHttpCacheSemantics`.
