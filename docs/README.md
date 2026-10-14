# qHttp documentation

Guides for building requests, composing middleware, caching, handling errors, realtime transports and the React resource layer.

## Guides

| Guide | What you'll learn |
|-------|-------------------|
| [Getting started](./getting-started.md) | Core concepts, per-call options, result objects, status, cancel |
| [Requests](./requests.md) | URLs, query params, bodies, response types, validation, pagination |
| [Middleware](./middleware.md) | Pipeline order, writing middleware, built-in steps |
| [Caching](./caching.md) | TTL and HTTP modes, keys, engines, invalidation |
| [Hooks](./hooks.md) | Interceptors, transformation, error recovery |
| [Retry & errors](./retry-and-errors.md) | Retry, deadline, rate limit, circuit breaker, `QHttpError` |
| [Authentication](./authentication.md) | Bearer providers, refresh, basic, custom |
| [Adapters](./adapters.md) | Fetch options, HTTP/2, custom transports |
| [React](./react.md) | `ResourceStore`, `useResource`, `useAction`, Suspense, pagination, live feeds |
| [WebSockets](./websockets.md) | `QWebSocket`, reconnect, Node `ws` |
| [SSE](./sse.md) | `QEventSource`, reconnect, async iteration |
| [Testing](./testing.md) | `MockAdapter` and `mockResponse` |
| [API reference](./api-reference.md) | Quick method and type lookup |

## Design principles

1. **Thin over `fetch`.** QHttp orchestrates transport, parsing and policy; uncached overhead stays near native `fetch`.
2. **Defaults on the client, overrides per call.** Chain setters for reusable clients; pass options per request. Per-call options never mutate the instance.
3. **Everything is middleware.** Auth, cache, dedupe, retry, timeout, rate limiting and transport are composable steps; add your own with `use()`.
4. **Explicit cache.** Opt-in TTL cache with auth-aware keys, or RFC 9111 semantics when responses carry cache headers.
5. **Runtime agnostic.** Same API in Node, browsers and edge; adapters swap transport details.

## Minimal example

```typescript
import { QHttp } from '@questorylabs/qhttp';

const api = new QHttp({ baseUrl: 'https://api.example.com' })
  .setAuth({ type: 'bearer', token: () => getToken() })
  .setRetry({ retries: 3, backoff: 'exponential', jitter: true })
  .setTimeout(10_000);

const { data } = await api.get<{ items: string[] }>('/items', { params: { page: 1 } });
```

See [Getting started](./getting-started.md) for the full walkthrough.
