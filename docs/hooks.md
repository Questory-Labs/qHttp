# Hooks

Hooks let you intercept the request lifecycle without subclassing `QHttp`. Register with chainable methods or the generic `.hook(phase, fn)` API.

## Hook phases

| Phase | When | Typical use |
|-------|------|-------------|
| `preRequest` | Before cache lookup / network | Auth headers, logging, URL tweaks |
| `preCache` | Before cache read | Metrics, debug |
| `postCache` | After cache write | Audit trail |
| `postRequest` | After success (network or cache) | Transform `data`, normalize |
| `onError` | On failure | Recovery, fallback responses |
| `onRetry` | Before each retry attempt | Logging, backoff metrics |
| custom string | Same as `hook('myPhase', fn)` | Domain-specific pipelines |

## preRequest

Mutate the request context or return a partial patch:

```typescript
client.preRequest((ctx) => {
  ctx.headers.set('authorization', `Bearer ${getToken()}`);
  ctx.headers.set('x-timezone', Intl.DateTimeFormat().resolvedOptions().timeZone);
});

// Return a patch (merged with context)
client.preRequest(() => ({
  queryParams: { _ts: Date.now() },
}));
```

`RequestContext` fields: `baseUrl`, `url`, `resolvedUrl`, `method`, `headers` (Map), `queryParams`, `body`, `timeout`, `responseType`, `signal`, `macros`, `auth`.

Hooks run in registration order; patches are shallow-merged.

## postRequest

Transform the result after a successful response:

```typescript
client.postRequest(({ result, ctx }) => {
  if (result.data && typeof result.data === 'object') {
    result.data = {
      ...result.data,
      _fetchedAt: Date.now(),
    };
  }
});
```

Runs for cache hits too — your transform applies to cached data.

## onError

Recover from errors by returning a synthetic `QHttpResult`:

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
    };
  }
});
```

First recovery hook that returns a result wins. Otherwise the error propagates (or becomes a failed result when `throwOnError: false`).

## onRetry

```typescript
client
  .setRetry({ retries: 3, backoff: 'exponential' })
  .onRetry(({ attempt, error }) => {
    console.warn(`Retry ${attempt}`, error);
  });
```

## Custom phases

```typescript
client.hook('beforeTransform', (ctx) => {
  // integrate with your own pipeline
});
```

Use `HookManager` directly if building middleware outside `QHttp`:

```typescript
import { HookManager } from '@questorylabs/qhttp';

const hooks = new HookManager();
hooks.add('preRequest', (ctx) => ctx);
```

## Clone preserves hooks

```typescript
const child = client.clone(); // copies hook registrations
```

## Guidelines

1. **Keep preRequest fast** — it runs on every request including cache hits' post path setup.
2. **Don't throw in hooks** unless you intend to fail the request — uncaught errors bubble up.
3. **onError recovery** is for controlled fallbacks, not silent swallowing of all errors.
4. **postRequest mutations** affect what callers receive and what you might re-read from cache on the next hit.
5. **Auth in preRequest** works alongside `setAuth()` — both apply; last writer on headers wins for duplicates.

See [Authentication](./authentication.md) for built-in auth helpers.
