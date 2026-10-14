# @questorylabs/qhttp

> Fluent, middleware-based HTTP client with caching, retries, rate limiting, WebSocket + SSE clients and React resource hooks. Node, browsers, edge.

MIT · Node ≥ 20 · ESM + CJS

---

## Install

```bash
pnpm add @questorylabs/qhttp
```

Optional peers:

```bash
pnpm add ws                   # Node WebSockets
pnpm add http-cache-semantics # RFC 9111 HTTP cache mode
pnpm add react                # React hooks
```

### Entry points

| Import                            | Contents                                                                 |
| --------------------------------- | ------------------------------------------------------------------------ |
| `@questorylabs/qhttp`             | `QHttp`, middleware types, cache engines, `RateLimiter`, `CircuitBreaker`, pagination helpers, `QHttpError` |
| `@questorylabs/qhttp/react`       | `ResourceProvider`, `useResource`, `useAction`, `useLiveResource`, `useSuspenseResource`, `usePagedResource` |
| `@questorylabs/qhttp/resource`    | Framework-agnostic `ResourceStore`                                       |
| `@questorylabs/qhttp/ws`          | `QWebSocket`, browser/Node adapters                                      |
| `@questorylabs/qhttp/sse`         | `QEventSource`, `subscribeSse`, SSE parser                               |
| `@questorylabs/qhttp/http2`       | `Http2Adapter` (Node)                                                    |
| `@questorylabs/qhttp/http-cache`  | RFC 9111 policy helpers                                                  |
| `@questorylabs/qhttp/testing`     | `MockAdapter`, `mockResponse`                                            |

---

## Quick start

One client, per-call options. The instance holds defaults; each call may override them without touching the instance, so a shared client is safe under concurrency.

```typescript
import { QHttp, pageParam } from '@questorylabs/qhttp';

const api = new QHttp({ baseUrl: 'https://api.example.com' })
  .setAuth({ type: 'bearer', token: () => tokens.access, refresh: { run: () => tokens.refresh() } })
  .setRetry({ retries: 2, backoff: 'exponential', jitter: true })
  .setTimeout(5_000)
  .setDeadline(20_000)
  .setFetchOptions({ credentials: 'include' })
  .rateLimit({ requestsPerSecond: 10, concurrency: 4 })
  .dedupe();

const { data } = await api.get<User[]>('/users', { params: { page: 1 } });

await api.post('/users', { body: { name: 'Ada' }, parse: UserSchema });

for await (const page of api.paginate<Page>({ url: '/orders', next: pageParam({ hasMore: (r) => r.data.hasMore }) })) {
  render(page.data.items);
}
```

The chainable style still works and composes with per-call options:

```typescript
const req = new QHttp().setBaseUrl(url).setUrl('/users/{{id}}').replaceUrlMacros({ id: 'u1' });
const result = await req.get();
```

### Middleware

```typescript
api.use(async (ctx, next) => {
  const started = performance.now();
  try {
    return await next();
  } finally {
    log(ctx.method, ctx.resolvedUrl, performance.now() - started, ctx.requestId);
  }
});
```

User middleware runs outermost, then auth, cache, dedupe, retry, timeout, rate limit and transport.

### React

```tsx
import { ResourceProvider, useResource, useAction } from '@questorylabs/qhttp/react';

function Dashboard() {
  const stats = useResource({
    id: ['dashboard'],
    load: () => api.get<Stats>('/stats').then((r) => r.data),
    refreshEvery: 30_000,
    keepPrevious: true,
  });

  const save = useAction({
    run: (name: string) => api.patch('/me', { body: { name } }),
    optimistic: (name) => [[['me'], (prev) => ({ ...(prev as Me), name })]],
    touches: [['me'], ['dashboard']],
  });

  if (stats.empty) return <Spinner />;
  return <Stats value={stats.value} onRename={save.submit} />;
}
```

### Live data

```typescript
import { QEventSource } from '@questorylabs/qhttp/sse';
import { QWebSocket } from '@questorylabs/qhttp/ws';

const events = new QEventSource('/stream', { headers: { authorization: `Bearer ${t}` } })
  .onJson<Tick>((tick) => update(tick), 'tick')
  .connect();

const socket = new QWebSocket('wss://example.com/socket')
  .setReconnect({ retries: 5, delay: 1000, backoff: 'exponential', jitter: true })
  .setHeartbeat({ intervalMs: 30_000, message: 'ping', isPong: 'pong', pongTimeoutMs: 5_000 })
  .onJson((msg) => handle(msg))
  .connect();
```

### Testing

```typescript
import { MockAdapter } from '@questorylabs/qhttp/testing';

const mock = new MockAdapter()
  .get('/users/:id', (_req, { params }) => ({ body: { id: params.id } }))
  .once('GET', '/flaky', { status: 503 });

const api = new QHttp({ adapter: mock, baseUrl: 'https://api.test' });
```

---

## Documentation

Guides live in [docs/](./docs/README.md).

| Guide                                        | Topics                                                        |
| -------------------------------------------- | ------------------------------------------------------------- |
| [Getting started](./docs/getting-started.md) | Concepts, per-call options, results, status, cancel           |
| [Requests](./docs/requests.md)               | URLs, macros, params, bodies, parsing, validation, pagination |
| [Middleware](./docs/middleware.md)           | Pipeline order, writing middleware, built-in steps            |
| [Caching](./docs/caching.md)                 | TTL and HTTP modes, keys, engines, invalidation               |
| [Hooks](./docs/hooks.md)                     | `preRequest`, `postRequest`, `onError`, custom phases         |
| [Retry & errors](./docs/retry-and-errors.md) | Backoff, deadline, rate limit, circuit breaker, error codes   |
| [Authentication](./docs/authentication.md)   | Bearer providers, refresh, basic, custom                      |
| [Adapters](./docs/adapters.md)               | Fetch options, HTTP/2, custom transports                      |
| [React](./docs/react.md)                     | Resource store and hooks                                      |
| [WebSockets](./docs/websockets.md)           | Reconnect, heartbeat, Node `ws`                               |
| [SSE](./docs/sse.md)                         | `QEventSource`, reconnect, async iteration                    |
| [Testing](./docs/testing.md)                 | `MockAdapter`                                                 |
| [API reference](./docs/api-reference.md)     | Method and type cheat sheet                                   |

---

## Features

| Area           | Highlights                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------- |
| **API**        | Per-call options + chainable defaults on one client; safe for concurrent use                |
| **Pipeline**   | Koa-style middleware; built-in auth, cache, dedupe, retry, timeout, rate limit, transport    |
| **Auth**       | Static or provider tokens, single-flight refresh on 401, basic, custom                       |
| **Resilience** | Exponential/fixed backoff with equal jitter, `Retry-After`, per-attempt timeout, deadline, circuit breaker, per-origin rate limit |
| **Cache**      | TTL store with auth-aware keys, RFC 9111 mode with SWR and conditional revalidation         |
| **Validation** | Standard Schema (zod, valibot, arktype) or function parsers; `VALIDATION_ERROR` with issues |
| **Progress**   | Upload and download via `onProgress` (FormData and streams included)                        |
| **Transport**  | Fetch with init passthrough and native `Response`, optional HTTP/2 on Node, mock adapter    |
| **Realtime**   | WebSocket with reconnect/heartbeat, SSE with reconnect and `Last-Event-ID`                  |
| **React**      | Resource store with GC and hydration; `useResource`, `useAction` with optimistic updates, Suspense, pagination, live feeds |
| **Observability** | `requestId`, timing, attempt count on every result and error; redacted error payloads   |

---

## Limitations

- No HTTP/3 adapter in core; use `.setAdapter()` for custom transports.
- `Http2Adapter` does not support `FormData` or `ReadableStream` request bodies and buffers responses; use the fetch adapter for upload progress and streaming.
- FormData upload `total` is estimated from field sizes; opaque streams only get `total` when `Content-Length` is set.
- In-memory cache and resource store do not persist across serverless cold starts.
- HTTP cache mode requires `http-cache-semantics` and stores one variant per key; use explicit keys for multiple `Vary` representations.
- `fetchStatus` on the instance reflects the most recent transition; with concurrent calls use `result.fetchStatus` and `client.inFlight`.

---

## License

MIT
