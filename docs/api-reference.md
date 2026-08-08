# API reference

Quick lookup for `QHttp` and related exports. For narrative guides, see the other docs.

## QHttp constructor

```typescript
new QHttp(config?: QHttpConfig)
```

### QHttpConfig

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `baseUrl` | `string` | — | Base URL for relative paths |
| `url` | `string` | — | Default path (supports `{{macros}}`) |
| `method` | `HttpMethod` | — | Default method |
| `headers` | `HeadersInit` | — | Default headers |
| `queryParams` | `QueryParams` | — | Default query |
| `body` | `RequestBody` | — | Default body |
| `timeout` | `number` | — | Timeout ms |
| `responseType` | `ResponseType` | `'auto'` | Response parsing |
| `adapter` | `HttpAdapter` | fetch | Transport |
| `retry` | `RetryOptions` | — | Retry policy |
| `cache` | `boolean` | `false` | Enable cache |
| `cacheMode` | `'ttl' \| 'http'` | `'ttl'` | Cache semantics |
| `cacheTTL` | `number` | — | TTL ms (TTL mode only) |
| `cacheEngine` | `CacheEngine` | default | Cache backend |
| `cacheKey` | `string \| fn` | auto | Cache key |
| `cacheWhen` | `fn` | — | Conditional cache |
| `cacheMethods` | `HttpMethod[]` | GET, HEAD | Cached methods |
| `httpCache` | `HttpCacheOptions` | — | HTTP cache options |
| `auth` | `AuthConfig` | — | Bearer / Basic |
| `signal` | `AbortSignal` | — | External abort |
| `throwOnError` | `boolean` | `true` | Throw on failure |
| `validateStatus` | `fn` | 2xx | Success predicate |
| `paramsSerializer` | `fn` | — | Custom query string |
| `urlMacros` | `record` | — | Macro values |

## QHttp instance methods

### Configuration

| Method | Description |
|--------|-------------|
| `setBaseUrl(url)` | Set base URL |
| `setUrl(url)` | Set path |
| `replaceUrlMacros(macros)` | Merge macro values |
| `setQueryParams(params)` | Merge query params |
| `paramsSerializer(fn)` | Custom serializer |
| `setHeaders(headers)` | Merge headers |
| `setBody(body)` | Set request body |
| `setTimeout(ms)` | Request timeout |
| `setResponseType(type)` | Parse mode |
| `setRetry(options)` | Retry policy |
| `cache(enabled?)` | Toggle TTL cache |
| `httpCache(options?)` | Enable RFC 9111 HTTP cache |
| `cacheTTL(ms)` | Cache TTL (TTL mode) |
| `cacheEngine(engine)` | Cache backend |
| `cacheKey(key)` | Cache key |
| `cacheWhen(fn)` | Conditional cache |
| `cacheMethods(methods)` | Methods to cache |
| `setAuth(auth)` | Bearer / Basic |
| `setSignal(signal)` | AbortSignal |
| `setAdapter(adapter)` | HTTP adapter |
| `validateStatus(fn)` | Status predicate |
| `throwOnError(bool)` | Throw vs result |
| `onProgress(fn)` | Upload + download progress (`direction`) |
| `onStateChange(fn)` | fetchStatus subscription |

### Hooks

| Method | Phase |
|--------|-------|
| `preRequest(fn)` | Before request |
| `postRequest(fn)` | After success |
| `onError(fn)` | On failure |
| `onRetry(fn)` | Before retry |
| `hook(phase, fn)` | Custom phase |

### Execution

| Method | Description |
|--------|-------------|
| `get(url?)` | GET request |
| `post(url?)` | POST request |
| `put(url?)` | PUT request |
| `patch(url?)` | PATCH request |
| `delete(url?)` | DELETE request |
| `head(url?)` | HEAD request |
| `options(url?)` | OPTIONS request |
| `request({ method, url })` | Generic request |
| `cancel()` | Abort in-flight |
| `reset()` | Reset fetchStatus |
| `clone()` | Copy client + hooks |
| `getCacheEngine()` | Resolved cache engine |

### Static methods

| Method | Description |
|--------|-------------|
| `configureDefaultCacheEngine(engine)` | Global cache |
| `getCache(key)` | Read default cache |
| `setCache(key, value, ttl?)` | Write default cache |
| `deleteCache(key)` | Delete entry |
| `deleteCacheByPrefix(prefix)` | Prefix delete |
| `clearCache()` | Clear all |

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `fetchStatus` | `FetchStatus` | Last request status |

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
}
```

## Types

```typescript
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
type ResponseType = 'auto' | 'json' | 'text' | 'blob' | 'arrayBuffer' | 'stream';
type FetchStatus = 'idle' | 'loading' | 'success' | 'error';
type BackoffStrategy = 'fixed' | 'exponential';

type AuthConfig =
  | { type: 'bearer'; token: string }
  | { type: 'basic'; username: string; password: string };

interface RetryOptions {
  retries?: number;
  backoff?: BackoffStrategy;
  retryDelay?: number;
  maxDelay?: number;
  jitter?: boolean;
  retryOn?: (error: unknown, attempt: number) => boolean;
}
```

## QWebSocket

```typescript
new QWebSocket(url, { queueLimit?: number })
```

| Method | Description |
|--------|-------------|
| `setProtocols(p)` | WS subprotocols |
| `setHeaders(h)` | Node headers |
| `setAdapter(a)` | WS adapter |
| `setReconnect(opts)` | Reconnect policy |
| `setHeartbeat(opts)` | Ping / timeout |
| `onOpen(fn)` | Open handler |
| `onMessage(fn)` | Message handler |
| `onError(fn)` | Error handler |
| `onClose(fn)` | Close handler |
| `onReconnect(fn)` | Reconnect handler |
| `off(event, fn)` | Unsubscribe |
| `connect()` | Open connection |
| `send(data)` | Send raw |
| `sendJson(obj)` | Send JSON |
| `close(code?, reason?)` | Close socket |
| `readyState` | Connection state |

## Package exports

### `@questorylabs/qhttp`

`QHttp`, `FetchAdapter`, `defaultFetchAdapter`, `MemoryCacheEngine`, `LocalStorageCacheEngine`, `configureDefaultCacheEngine`, `getDefaultCacheEngine`, `resetDefaultCacheEngine`, `buildCacheKey`, `buildCacheKeyFromContext`, `resolveMacros`, `findUnresolvedMacros`, `serializeParams`, `joinUrl`, `QHttpError`, `isQHttpError`, `HookManager`, types.

### `@questorylabs/qhttp/ws`

`QWebSocket`, `BrowserWSAdapter`, `NodeWSAdapter`, `createNodeWSSocket`, WS types.

### `@questorylabs/qhttp/http2`

`Http2Adapter`.
