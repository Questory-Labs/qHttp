# qHttp documentation

Welcome to the qHttp docs. These guides explain how to build requests, wire hooks, cache responses, handle errors, and use WebSockets — with examples you can copy into your project.

## Guides

| Guide | What you'll learn |
|-------|-------------------|
| [Getting started](./getting-started.md) | Core concepts, client lifecycle, result objects |
| [Requests](./requests.md) | URLs, query params, bodies, response types, timeouts |
| [Caching](./caching.md) | Engines, TTL, keys, conditional cache, static API |
| [Hooks](./hooks.md) | Interceptors, transformation, error recovery |
| [Retry & errors](./retry-and-errors.md) | Retry policies, `QHttpError`, `throwOnError` |
| [Authentication](./authentication.md) | Bearer and Basic credentials |
| [Adapters](./adapters.md) | Fetch, HTTP/2, custom transports |
| [WebSockets](./websockets.md) | `QWebSocket`, reconnect, Node `ws` |
| [API reference](./api-reference.md) | Quick method and type lookup |

## Design principles

1. **Thin over `fetch`** — QHttp wraps transport, parsing, and policy; uncached overhead stays near native `fetch`.
2. **Two API styles** — chain methods for reusable clients; call setters imperatively when config depends on runtime state.
3. **Explicit cache** — opt-in TTL cache, not browser HTTP cache semantics.
4. **Hooks over inheritance** — extend behavior with functions, not subclass trees.
5. **Runtime agnostic** — same API in Node, browsers, and edge; adapters swap transport details.

## Minimal example

```typescript
import { QHttp } from '@questorylabs/qhttp';

const api = new QHttp({ baseUrl: 'https://api.example.com' })
  .setAuth({ type: 'bearer', token: process.env.API_TOKEN! })
  .setRetry({ retries: 3, backoff: 'exponential', jitter: true })
  .setTimeout(10_000);

const { data } = await api.get<{ items: string[] }>('/items');
```

See [Getting started](./getting-started.md) for the full walkthrough.
