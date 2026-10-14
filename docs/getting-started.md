# Getting started

## What is QHttp?

QHttp is a small client library that adds structure around `fetch`:

- Configure base URL, headers, auth, retry, cache and transport once on a **reusable client**
- Override anything **per call** without mutating the client
- Get a rich **result object** (`data`, HTTP status, headers, cache flag, timing, request id)
- Extend behaviour with **middleware** and **hooks**

It is not a replacement for `fetch` semantics; it orchestrates them.

## Creating a client

```typescript
import { QHttp } from '@questorylabs/qhttp';

const client = new QHttp({
  baseUrl: 'https://api.example.com',
  timeout: 5000,
  throwOnError: true,
});

client
  .setHeaders({ Accept: 'application/json' })
  .setQueryParams({ locale: 'en' });
```

Setters configure **defaults**. Reuse the instance across your app; it is safe to call concurrently.

## Making requests

Every verb takes an optional URL and optional per-call options:

```typescript
await client.get('/users');
await client.get('/users', { params: { page: 2 } });
await client.post('/users', { body: { name: 'Ada' } });
await client.put('/users/u1', { body: user, timeout: 10_000 });
await client.patch('/users/u1', { body: { name: 'B' }, retry: false });
await client.delete('/users/u1', { headers: { 'x-reason': 'gdpr' } });
await client.head('/users');
await client.options('/users');

await client.request({ method: 'POST', url: '/events', body: event });
```

Per-call options (`RequestOptions`): `url`, `params`, `headers`, `body`, `macros`, `timeout`, `deadline`, `responseType`, `signal`, `retry`, `cache`, `cacheTTL`, `cacheKey`, `auth`, `throwOnError`, `validateStatus`, `fetchOptions`, `parse`, `dedupe`, `onProgress`, `meta`.

Option headers and params merge over the instance defaults; everything else replaces the default for that call only.

## The result object

```typescript
const result = await client.get<{ id: string }>('/users/u1');

result.data;        // parsed body (type T)
result.httpStatus;  // 200
result.statusText;  // "OK"
result.headers;     // plain record, lowercase keys
result.ok;          // 2xx
result.response;    // native Response (fetch adapter, non-cached)
result.request;     // final outbound request (url, method, headers, init)
result.fromCache;   // true when served from cache
result.requestId;   // unique per call; also on errors
result.timing;      // { startedAt, endedAt, durationMs, attempts }
result.fetchStatus; // 'success' on this result
result.error;       // set when throwOnError is false
```

## fetchStatus lifecycle

`client.fetchStatus` reflects the most recent transition on the instance:

| Status | Meaning |
|--------|---------|
| `idle` | No request yet, or after `reset()` |
| `loading` | A request started |
| `success` | A request completed |
| `error` | A request failed |

```typescript
client.onStateChange((status, ctx) => {
  if (status === 'error') showError(ctx.error?.message);
});
```

With concurrent calls prefer `result.fetchStatus` per call and `client.inFlight` for the active count.

## Clone, reset, cancel

```typescript
const uploads = client.clone().setTimeout(60_000); // forks config, hooks, middleware
client.reset();                                     // fetchStatus back to idle
client.cancel();                                    // aborts every in-flight request from this instance
```

External signals compose with timeouts and the deadline:

```typescript
const controller = new AbortController();
await client.get('/slow', { signal: controller.signal, timeout: 5_000, deadline: 20_000 });
```

## throwOnError

Default `true`: statuses rejected by `validateStatus` and transport failures throw `QHttpError`.

```typescript
const result = await client.get('/might-fail', { throwOnError: false });
if (result.error) {
  result.error.code;       // 'HTTP_ERROR'
  result.httpStatus;       // e.g. 404
  result.data;             // parsed error body, when any
  result.headers;          // response headers
}
```

## Next steps

- [Requests](./requests.md): URLs, bodies, parsing, validation, pagination
- [Middleware](./middleware.md): the pipeline and how to extend it
- [Caching](./caching.md): speed up repeated reads
- [Retry & errors](./retry-and-errors.md): resilience patterns
