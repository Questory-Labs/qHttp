# Hooks

Hooks intercept the request lifecycle without subclassing `QHttp`. For wrapping a whole call (timing, tracing, fallbacks) see [Middleware](./middleware.md).

## Phases

| Phase | When | Typical use |
|-------|------|-------------|
| `preRequest` | After the context is built, before middleware | Headers, URL tweaks, logging |
| `preCache` | Before the cache read (`ctx.state.cacheKey` set) | Metrics |
| `postCache` | Before the cache write | Audit |
| `postRequest` | After success (network or cache) | Transform `data` |
| `onError` | On failure, after retries | Recovery, fallback responses |
| `onRetry` | Before each retry sleep | Logging, metrics |
| custom string | `hook('myPhase', fn)` | Your own pipelines |

## preRequest

```typescript
client.preRequest((ctx) => {
  ctx.headers.set('x-request-id', ctx.requestId);
  ctx.headers.set('x-timezone', Intl.DateTimeFormat().resolvedOptions().timeZone);
});

client.preRequest(() => ({ meta: { source: 'web' } })); // partial patch, shallow-merged
```

`RequestContext` fields: `requestId`, `startedAt`, `baseUrl`, `url`, `resolvedUrl`, `method`, `headers` (Map), `queryParams`, `body`, `timeout`, `deadline`, `responseType`, `signal`, `macros`, `auth`, `fetchOptions`, `parse`, `validateStatus`, `meta`, `state`.

Changing `url` or `queryParams` in a hook does not rebuild `resolvedUrl`; set `resolvedUrl` directly when rewriting targets.

## postRequest

```typescript
client.postRequest(({ result, ctx }) => {
  result.data = { ...(result.data as object), fetchedAt: result.timing.endedAt };
});
```

Runs for cache hits too.

## onError

Return a `QHttpResult` to recover:

```typescript
client.onError((error) => {
  if (error.httpStatus === 404) {
    return {
      data: { items: [] },
      httpStatus: 200,
      statusText: 'OK',
      headers: {},
      ok: true,
      request: { url: '', method: 'GET', headers: {} },
      fetchStatus: 'success',
      fromCache: false,
      requestId: error.requestId ?? '',
      timing: { startedAt: 0, endedAt: 0, durationMs: 0, attempts: 0 },
    };
  }
});
```

The first hook that returns a result wins; otherwise the error propagates (or becomes a failed result when `throwOnError: false`).

## onRetry

```typescript
client.setRetry({ retries: 3 }).onRetry(({ attempt, error }) => metrics.retry(attempt, error));
```

## Custom phases and HookManager

```typescript
client.hook('beforeTransform', (ctx) => { /* ... */ });

import { HookManager } from '@questorylabs/qhttp';
const hooks = new HookManager();
hooks.add('preRequest', (ctx) => ctx);
```

`clone()` copies hook registrations and middleware.

## Guidelines

1. **Keep `preRequest` fast**; it runs before every cache lookup.
2. **Don't throw in hooks** unless you intend to fail the request.
3. **Use `onError` for controlled fallbacks**, not to silence every failure.
4. **Mutations in `postRequest`** affect what callers receive and what is cached.
5. **`setAuth` plus `preRequest`** both apply; the last writer of a header wins.
