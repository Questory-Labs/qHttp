# @questorylabs/qhttp

> Fluent, extensible HTTP + WebSocket client for Node, browsers, and edge runtimes.

MIT · Node ≥ 20 · ESM + CJS

---

## Table of contents

- [Install](#install)
- [Quick start](#quick-start)
- [Documentation](#documentation)
- [Features](#features)
- [Limitations](#limitations)
- [License](#license)

---

## Install

```bash
pnpm add @questorylabs/qhttp
```

Optional peers:

```bash
pnpm add ws                  # Node WebSockets
pnpm add http-cache-semantics # RFC 9111 HTTP cache mode
```

### Package entry points


| Import                           | Use for                                     |
| -------------------------------- | ------------------------------------------- |
| `@questorylabs/qhttp`            | `QHttp`, cache engines, adapters, utilities |
| `@questorylabs/qhttp/ws`         | `QWebSocket`, browser/Node WS adapters      |
| `@questorylabs/qhttp/http2`      | `Http2Adapter` (Node only)                  |
| `@questorylabs/qhttp/http-cache` | HTTP cache policy helpers                   |
| `@questorylabs/qhttp/react`      | `ResourceStore`, `useResource`, `useAction`, `useLiveResource` |


### React resource layer (`@questorylabs/qhttp/react`)

Framework-agnostic `ResourceStore` plus thin React bindings — not a TanStack Query clone.

```tsx
import { ResourceProvider, useResource, useAction, useStore } from '@questorylabs/qhttp/react';

function App() {
  return (
    <ResourceProvider defaults={{ freshFor: 30_000, retries: 1 }}>
      <Dashboard />
    </ResourceProvider>
  );
}

function Dashboard() {
  const stats = useResource({
    id: ['dashboard'],
    load: () => fetch('/api/stats').then((r) => r.json()),
    refreshEvery: 30_000,
  });

  const save = useAction({
    run: (name: string) => fetch('/api/profile', { method: 'PATCH', body: name }),
    touches: [['me'], ['dashboard']],
  });

  if (stats.empty) return <p>Loading…</p>;
  return <pre>{JSON.stringify(stats.value)}</pre>;
}
```

Resource results expose `value`, `empty`, `busy`, `refreshing`, `failed`, `ready`, and `reload()`.
Live SSE/WebSocket feeds use `useLiveResource` with an injected `subscribe` callback.


---



## Quick start

**Chainable** — configure once, call many times:

```typescript
import { QHttp } from '@questorylabs/qhttp';

const client = new QHttp({ baseUrl: 'https://api.example.com' })
  .setUrl('/users/{{userId}}')
  .replaceUrlMacros({ userId: 'u1' })
  .setQueryParams({ page: 1 })
  .setHeaders({ 'X-App': 'demo' })
  .setTimeout(5000)
  .cache()
  .cacheKey('users:{{userId}}')
  .preRequest((ctx) => {
    ctx.headers.set('x-timezone', 'UTC');
  })
  .postRequest(({ result }) => {
    result.data = { ...(result.data as object), transformed: true };
  });

const { data, httpStatus, fetchStatus } = await client.get();
```

**Imperative** — mutate between calls:

```typescript
const req = new QHttp();
req.setBaseUrl('https://api.example.com');
req.setUrl('/recommendations');
if (userId) req.setQueryParams({ userId });

const result = await req.get();
```

**WebSocket**:

```typescript
import { QWebSocket } from '@questorylabs/qhttp/ws';

const socket = new QWebSocket('wss://example.com/socket')
  .setReconnect({ retries: 5, delay: 1000, backoff: 'exponential' })
  .setHeartbeat({ intervalMs: 30000, message: 'ping', pongTimeoutMs: 5000 })
  .onMessage((msg) => console.log(msg.data))
  .connect();

socket.sendJson({ type: 'subscribe', channel: 'orders' });
```

---



## Documentation

Full guides with examples, guidelines, and API notes live in `[docs/](./docs/README.md)`.


| Guide                                        | Topics                                                    |
| -------------------------------------------- | --------------------------------------------------------- |
| [Getting started](./docs/getting-started.md) | Concepts, `fetchStatus`, result shape, clone/reset/cancel |
| [Requests](./docs/requests.md)               | URLs, macros, query params, body types, response parsing  |
| [Caching](./docs/caching.md)                 | TTL + HTTP cache modes, engines, keys, `cacheWhen`        |
| [Hooks](./docs/hooks.md)                     | `preRequest`, `postRequest`, `onError`, custom phases     |
| [Retry & errors](./docs/retry-and-errors.md) | Backoff, jitter, `Retry-After`, `QHttpError` codes        |
| [Authentication](./docs/authentication.md)   | Bearer and Basic auth                                     |
| [Adapters](./docs/adapters.md)               | Fetch default, HTTP/2, custom transports                  |
| [WebSockets](./docs/websockets.md)           | Reconnect, heartbeat, Node `ws` adapter                   |
| [API reference](./docs/api-reference.md)     | Method and type cheat sheet                               |


---



## Features


| Area          | Highlights                                                                                |
| ------------- | ----------------------------------------------------------------------------------------- |
| **API style** | Chainable builders + imperative setters on the same client                                |
| **Lifecycle** | `fetchStatus`: `idle` → `loading` → `success` | `error` (separate from HTTP status)       |
| **URLs**      | Base URL joining, query serialization, `{{macro}}` templates                              |
| **Hooks**     | `preRequest`, `postRequest`, `onError`, `onRetry`, `preCache`, `postCache`, custom phases |
| **Retry**     | Exponential/fixed backoff, jitter, `Retry-After` header, idempotent-method defaults       |
| **Cache**     | TTL key/value store (~476k hits/s) + optional RFC 9111 HTTP mode via `.httpCache()`       |
| **Progress**  | Upload + download via `onProgress` (FormData / streams included)                          |
| **Transport** | Pluggable `HttpAdapter`; fetch by default, optional HTTP/2 on Node                        |
| **WebSocket** | Reconnect, heartbeat, send queue, browser + Node adapters                                 |
| **Runtimes**  | Node, browsers, edge — no framework lock-in                                               |


---



## Limitations

- No HTTP/3 adapter in core — use `.setAdapter()` for custom transports
- `Http2Adapter` does not support `FormData` or `ReadableStream` request bodies (string / Buffer / ArrayBuffer / typed arrays / Blob / `URLSearchParams` only). Upload progress wrapping uses streams, so use the default fetch adapter when you need upload progress
- FormData upload `total` is estimated from field sizes (not exact multipart byte length); opaque streams only get `total` when `Content-Length` is set
- In-memory cache state does not persist across serverless cold starts
- HTTP cache mode (`.httpCache()`) requires `http-cache-semantics`; TTL mode (`.cache()`) has no extra deps
- HTTP cache stores one variant per key — use explicit keys when caching multiple `Vary` representations

---



## License

MIT