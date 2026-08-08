# Getting started

## What is QHttp?

QHttp is a small client library that adds structure around `fetch`:

- Configure base URL, headers, auth, retry, and cache on a **reusable client**
- Get a rich **result object** (`data`, HTTP status, headers, cache flag, errors)
- Track client-level **fetch status** for UI bindings
- Plug in **hooks** for auth tokens, logging, or response transforms

It is not a replacement for `fetch` semantics — it orchestrates them.

## Creating a client

Pass initial config to the constructor, then chain or call setters:

```typescript
import { QHttp } from '@questorylabs/qhttp';

// Constructor config
const client = new QHttp({
  baseUrl: 'https://api.example.com',
  timeout: 5000,
  throwOnError: true,
});

// Chainable setters return `this`
client
  .setHeaders({ Accept: 'application/json' })
  .setQueryParams({ locale: 'en' });
```

Reuse the same instance for many requests. State (URL, query, body) persists until you change it.

## Making requests

HTTP methods are available as convenience methods. Each accepts an optional URL override:

```typescript
await client.get('/users');
await client.post('/users', /* url optional if setUrl was used */);
await client.put('/users/u1');
await client.patch('/users/u1');
await client.delete('/users/u1');
await client.head('/users');
await client.options('/users');
```

For full control, use `request()`:

```typescript
await client.request({ method: 'POST', url: '/events' });
```

## The result object

Every successful call returns `QHttpResult<T>`:

```typescript
const result = await client.get<{ id: string }>('/users/u1');

result.data;          // parsed body (type T)
result.httpStatus;    // e.g. 200
result.statusText;    // e.g. "OK"
result.headers;       // plain record (lowercase keys)
result.ok;            // adapter-level ok flag
result.fetchStatus;   // 'success' on this result
result.fromCache;     // true when served from TTL cache
result.request;       // final outbound request snapshot
result.error;         // set when throwOnError is false
```

Type the response:

```typescript
interface User {
  id: string;
  name: string;
}

const { data } = await client.get<User>('/users/u1');
```

## fetchStatus lifecycle

`client.fetchStatus` reflects the **last request** on this instance:

| Status | Meaning |
|--------|---------|
| `idle` | No request yet, or after `reset()` |
| `loading` | Request in flight |
| `success` | Last request completed successfully |
| `error` | Last request failed (when not thrown) |

Subscribe for UI updates:

```typescript
client.onStateChange((status, ctx) => {
  if (status === 'loading') setSpinner(true);
  if (status === 'success') setSpinner(false);
  if (status === 'error') showError(ctx.error?.message);
});
```

`fetchStatus` on the result object mirrors the outcome of that specific call.

## Clone, reset, and cancel

```typescript
// Fork config + hooks for a scoped client
const uploadClient = client.clone().setTimeout(60_000);

// Clear fetchStatus back to idle
client.reset();

// Abort the in-flight request (uses AbortController internally)
client.cancel();
```

Combine with an external signal:

```typescript
const controller = new AbortController();
client.setSignal(controller.signal);
setTimeout(() => controller.abort(), 3000);
```

## throwOnError

Default: `true` — non-2xx (per `validateStatus`) and transport failures throw `QHttpError`.

Disable to always get a result:

```typescript
const client = new QHttp({ throwOnError: false });

const result = await client.get('/might-fail');
if (result.fetchStatus === 'error') {
  console.log(result.error?.code, result.httpStatus);
}
```

Custom success range:

```typescript
client.validateStatus((status) => status >= 200 && status < 400);
```

## Next steps

- [Requests](./requests.md) — URLs, bodies, response types
- [Caching](./caching.md) — speed up repeated reads
- [Hooks](./hooks.md) — auth tokens and transforms
- [Retry & errors](./retry-and-errors.md) — resilience patterns
