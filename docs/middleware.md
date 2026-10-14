# Middleware

Every request runs through a Koa-style pipeline. Each step receives the request context and a `next` function that runs the rest of the chain and returns the result.

```typescript
import type { Middleware } from '@questorylabs/qhttp';

const logging: Middleware = async (ctx, next) => {
  const started = performance.now();
  try {
    const result = await next();
    console.log(ctx.method, ctx.resolvedUrl, result.httpStatus, performance.now() - started);
    return result;
  } catch (error) {
    console.error(ctx.requestId, error);
    throw error;
  }
};

client.use(logging);
```

## Order

```
preRequest hooks
└─ user middleware (in registration order, outermost)
   └─ auth          apply credentials; refresh + replay on 401
      └─ cache      TTL / HTTP lookup, SWR, write-back
         └─ dedupe  share identical in-flight safe requests
            └─ retry        per policy, replayable bodies only
               └─ timeout   per-attempt signal
                  └─ rate limit / circuit breaker
                     └─ transport  serialize, adapter.send, parse, validateStatus, schema
postRequest hooks · onError hooks
```

User middleware sees cache hits as well as network results. Anything that must run per attempt belongs in `onRetry` or in a custom adapter.

## Context

`RequestContext` fields available to middleware and hooks:

| Field | Notes |
|-------|-------|
| `requestId`, `startedAt` | Correlation and timing |
| `url`, `baseUrl`, `resolvedUrl`, `method` | `resolvedUrl` includes the query string |
| `headers` | `Map<string, string>`, lowercase keys |
| `queryParams`, `body`, `macros` | As configured |
| `timeout`, `deadline`, `signal` | `signal` is the request-scope signal (cancel, user signal, deadline) |
| `responseType`, `parse`, `validateStatus` | Parsing policy |
| `auth`, `fetchOptions`, `onProgress` | Transport inputs |
| `meta` | Free-form data from `setMeta` / per-call `meta` |
| `state.attempt`, `state.cacheKey`, `state.authRefreshed` | Run state maintained by built-ins |

## Running downstream with another context

`next(otherCtx)` runs the remaining chain with a replacement context. The built-in cache uses this for background revalidation; auth refresh uses it for replay.

```typescript
const mirror: Middleware = async (ctx, next) => {
  const primary = await next();
  void next({ ...ctx, resolvedUrl: ctx.resolvedUrl.replace('api.', 'mirror.') }).catch(() => undefined);
  return primary;
};
```

## Short-circuiting

Return a `QHttpResult` without calling `next` to answer locally:

```typescript
client.use(async (ctx, next) => {
  if (ctx.meta.offline) {
    return {
      data: cached,
      httpStatus: 200,
      statusText: 'OK',
      headers: {},
      ok: true,
      request: { url: ctx.resolvedUrl, method: ctx.method, headers: {} },
      fetchStatus: 'success',
      fromCache: true,
      requestId: ctx.requestId,
      timing: { startedAt: ctx.startedAt, endedAt: Date.now(), durationMs: 0, attempts: 0 },
    };
  }
  return next();
});
```

## Built-ins as building blocks

The built-in steps are exported for custom pipelines outside `QHttp`:

```typescript
import {
  compose,
  createRetryMiddleware,
  timeoutMiddleware,
  createRateLimitMiddleware,
  createTransport,
  defaultFetchAdapter,
  HookManager,
} from '@questorylabs/qhttp';

const chain = compose([
  createRetryMiddleware({ retry: { retries: 2 }, hooks: new HookManager() }),
  timeoutMiddleware,
  createRateLimitMiddleware({ limiter }),
]);
const transport = createTransport(defaultFetchAdapter);
const result = await chain(ctx, (c) => transport(c ?? ctx, () => Promise.reject(new Error('end'))));
```

In applications prefer `client.use()`; the factories exist for building other clients on the same primitives.

## Guidelines

1. **Return the result** from `next()` (or a transformed copy). Dropping it breaks callers.
2. **Keep middleware idempotent** with respect to `ctx.headers`; the same context object flows through hooks.
3. **Use `ctx.meta`** to pass per-call flags from callers to middleware instead of inventing headers.
4. **Prefer hooks** (`preRequest`, `postRequest`, `onError`) for simple transforms; reach for middleware when you need to wrap the whole call.
