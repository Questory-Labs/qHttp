# Changelog

## 0.3.0

Middleware pipeline, per-call options, new entry points and a batch of security
and correctness fixes. The chainable API is unchanged; see **Breaking** for the
few behaviours that moved.

### Added

- **Per-call options** on every verb: `client.get(url, { params, headers, body, timeout, retry, cache, auth, parse, fetchOptions, signal, meta, ... })` and `client.request({ method, url, ...options })`. Options override instance config without mutating it, so one client serves concurrent callers safely.
- **Middleware pipeline.** `client.use((ctx, next) => ...)` runs outermost; built-in steps (auth, cache, dedupe, retry, timeout, rate limit, transport) are composed per request. `compose` and the `Middleware`/`Next` types are exported.
- **Fetch passthrough.** `setFetchOptions({ credentials, cache, redirect, keepalive, dispatcher, ... })` reaches the adapter as `request.init`. `FetchAdapter` accepts `{ defaults, fetch }`.
- **Native response.** `result.response` carries the `Response` from the fetch adapter; adapters may set `raw` on `RawResponseLike`.
- **Auth providers and refresh.** Bearer tokens may be functions (sync or async). `setAuth({ type: 'bearer', token, refresh: { run, on } })` refreshes once on 401 (single-flight across concurrent requests) and replays. `type: 'custom'` applies arbitrary credentials.
- **Schema validation.** `parse` accepts a Standard Schema (zod, valibot, arktype...) or a function; failures throw `VALIDATION_ERROR` with `issues`.
- **Request dedup.** `.dedupe()` shares one in-flight response between identical concurrent safe requests.
- **Rate limiting and circuit breaking.** `.rateLimit({ requestsPerSecond, burst, concurrency })` per origin, `.circuitBreaker({ failureThreshold, resetAfterMs })` with `CIRCUIT_OPEN` errors. `RateLimiter` and `CircuitBreaker` instances can be shared across clients.
- **Deadline.** `setDeadline(ms)` bounds the whole request including retries (`DEADLINE` error code), separate from the per-attempt `setTimeout`.
- **Timing and ids.** Results carry `requestId` and `timing { startedAt, endedAt, durationMs, attempts }`; `ctx.requestId`, `ctx.startedAt`, `ctx.meta` and `ctx.state.attempt` are available to hooks and middleware. Errors expose `requestId`.
- **Pagination.** `client.paginate({ next, ...options })` returns an async iterable with `.items()` and `.all()`; helpers `pageParam`, `cursorParam`, `linkHeader`.
- **`@questorylabs/qhttp/sse`.** `QEventSource`: fetch-based Server-Sent Events with custom headers, credentials, POST bodies, reconnect with backoff and `Last-Event-ID`, named events, JSON helper and async iteration. `subscribeSse(url, handlers, signal)` for callback style.
- **`@questorylabs/qhttp/testing`.** `MockAdapter` with `:param` routes, regex routes, `once`, delays, recorded `calls`, and a `mockResponse` builder.
- **`@questorylabs/qhttp/resource`.** Framework-agnostic `ResourceStore` entry.
- **Resource store.** Garbage collection of unobserved entries (`gcTime`, default 5 min), `dehydrate()` / `hydrate()` for SSR, `update()`, `subscribe()` for global change notifications, `has()`. Ids hash with sorted object keys.
- **React.** `useSuspenseResource`, `usePagedResource`, `keepPrevious` (with `placeholder` flag) on `useResource`, `optimistic` updates with rollback and `onSettled` on `useAction`, `sse` shortcut and `merge` on `useLiveResource`, `hydrate` prop on `ResourceProvider`.
- **WebSocket.** `onJson`, `onReconnected`, `onStateChange`, `on(event)`, `bufferedAmount`, `queuedCount`, reconnect `jitter`, heartbeat `isPong` matcher.
- **HTTP/2.** `Http2Adapter({ sessionIdleMs, connectOptions })`; idle sessions close automatically; forbidden connection headers are filtered.
- `QHttpError.status` (alias of `httpStatus`), `.data` (parsed error body), `.toJSON()`.
- `isAbsoluteUrl`, `stableStringify`, `fnv1a`, `redactHeaders`, `wrapFetchResponse` utilities.
- Tooling: eslint, publint + arethetypeswrong in CI, Node 20/22/24 matrix, size budgets per entry.

### Fixed

- **Cross-user cache leak.** The default cache key now hashes the `Authorization` header (configurable via `cacheVary`), so authenticated responses never cross users sharing one engine.
- **Credentials in errors.** `QHttpError.request` is a redacted summary: no auth config, no body, sensitive headers masked.
- `throwOnError: false` results keep the parsed body, headers and status text of the failed response.
- FormData uploads with `onProgress` re-serialize on every retry so the multipart boundary in the header always matches the body.
- `process.env` is no longer referenced in browser bundles.
- Shared modules (`ResourceStore`, cache policy, utilities) are emitted once per format; `ResourceStore` from the root and `/react` entries is the same class.
- `useLiveResource` no longer re-subscribes on every render when `id` is an inline array.
- `useResource` loads again after `store.drop()`; `reload` identity is stable.
- A push into the store during an in-flight load is no longer overwritten by the load result.
- Cache engine read/write failures are logged in development and never fail the request; `LocalStorageCacheEngine` evicts the oldest entries on quota pressure.
- HTTP cache entries are written with a TTL (freshness plus a 24h stale retention) so engines can reclaim memory; stale entries stay available for conditional revalidation and SWR.
- Stale-while-revalidate background work no longer shares the caller's abort controller.
- `QWebSocket` detaches listeners from replaced sockets, ignores late events from them, and no longer double-connects after `close()` + `connect()`.
- Browser WebSocket adapter warns when headers are passed (they cannot be sent).
- Empty JSON responses parse to `undefined` instead of throwing; XML, SVG and other text-like content types are decoded as text.
- `Blob` responses keep their content type; absolute URLs passed to a client with `baseUrl` are used as-is.
- Retry jitter is "equal jitter" (50–100% of the delay) instead of 0–100%.
- Rate limiter slot reservation is atomic with its check.

### Breaking

- The default cache engine is `MemoryCacheEngine` in every runtime. Opt into `LocalStorageCacheEngine` via `configureDefaultCacheEngine` or `.cacheEngine()` when you want persistence across page loads.
- `.cache()` without `cacheTTL` now expires entries after 5 minutes (`DEFAULT_CACHE_TTL_MS`) instead of never.
- `QHttpError.request` no longer includes `auth`, `body` or raw headers.
- `applyAuth` is async. `createAuthPreRequestHook` returns an async hook.
- `loadFromRequest` propagates `QHttpError` unchanged (use `error.status` or `error.httpStatus`).
- `toFinalRequest` takes an options object. `hydrateHttpCacheResult` no longer takes a progress handler.
- `QHttpResult` has two new required fields, `requestId` and `timing`; synthetic results returned from `onError` hooks or middleware should include them.
- `createRetryError` and `hasUnresolvedMacros` were removed.

## 0.2.1

- Resource load retries: exponential backoff, `retries` / `false` (default off; use HTTP `setRetry`)
- `refreshEvery` poll backoff via `RefreshScheduler` (stops after consecutive failures)
- Stable `load` identity (inline lambdas no longer re-fetch every render)
- `reload` forces refetch; `cancel()` works during retry backoff; Http2 respects abort
