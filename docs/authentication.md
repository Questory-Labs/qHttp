# Authentication

## Bearer

```typescript
client.setAuth({ type: 'bearer', token: 'static-key' });
client.setAuth({ type: 'bearer', token: () => tokenStore.current });       // read on every request
client.setAuth({ type: 'bearer', token: async () => await vault.token() }); // async provider
```

## Refresh on 401

```typescript
client.setAuth({
  type: 'bearer',
  token: () => session.accessToken,
  refresh: {
    on: [401],                       // default
    run: async () => {
      await session.refresh();       // update your store...
      return session.accessToken;    // ...or return the new token for static configs
    },
  },
});
```

On a matching status the client runs `refresh.run` once (concurrent requests share the in-flight refresh), re-applies credentials and replays the request once. A second failure propagates. Requests with stream bodies are not replayed.

## Basic

```typescript
client.setAuth({ type: 'basic', username: 'api', password: 'secret' });
```

## Custom schemes

```typescript
client.setAuth({
  type: 'custom',
  apply: async (ctx) => {
    ctx.headers.set('x-api-key', await keys.current());
    ctx.headers.set('x-signature', sign(ctx.method, ctx.resolvedUrl));
  },
  refresh: { on: [401, 403], run: () => keys.rotate() },
});
```

## Per call

```typescript
await client.get('/public', { auth: false });
await client.get('/admin', { auth: { type: 'bearer', token: adminToken } });
```

## Cache interaction

Authenticated responses are keyed per credential (the `Authorization` header is hashed into the cache key). See [Caching](./caching.md#cache-keys).

## Utilities

```typescript
import { applyAuth, createAuthPreRequestHook, resolveToken, toBase64 } from '@questorylabs/qhttp';
```

`applyAuth(ctx, auth)` is async and mutates the context in place.

## Guidelines

1. **Never log tokens.** `QHttpError` already redacts `authorization`, `cookie` and API-key headers.
2. **Prefer token providers** over static strings for anything that expires.
3. **Basic auth** encodes, it does not encrypt; HTTPS only.
4. **One refresh owner.** Put refresh on the client, not in app code around every call.
