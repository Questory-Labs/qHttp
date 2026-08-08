# Authentication

QHttp supports Bearer and Basic auth via `setAuth()` or manual headers in `preRequest`.

## Bearer token

```typescript
client.setAuth({ type: 'bearer', token: 'your-access-token' });

// Sets: Authorization: Bearer your-access-token
await client.get('/protected');
```

## Basic auth

```typescript
client.setAuth({
  type: 'basic',
  username: 'api',
  password: 'secret',
});

// Sets: Authorization: Basic base64(api:secret)
```

## Dynamic tokens (recommended)

Static `setAuth` is fine for long-lived keys. For expiring tokens, use `preRequest`:

```typescript
client.preRequest(async (ctx) => {
  const token = await tokenStore.getValidToken();
  ctx.headers.set('authorization', `Bearer ${token}`);
});
```

## Auth helper utilities

```typescript
import { applyAuth, createAuthPreRequestHook, toBase64 } from '@questorylabs/qhttp';

const hook = createAuthPreRequestHook({ type: 'bearer', token: 'x' });
// equivalent to client.preRequest(hook)
```

`applyAuth` mutates a `RequestContext` in place — useful in custom pipelines.

## Custom schemes

For API keys, HMAC, or mTLS metadata in headers:

```typescript
client.preRequest((ctx) => {
  ctx.headers.set('x-api-key', process.env.API_KEY!);
});
```

QHttp does not terminate TLS or attach certificates — configure that at the adapter / Node layer.

## Guidelines

1. **Never log** full tokens in `postRequest` or error handlers.
2. **Prefer preRequest** when tokens refresh — `setAuth` is not re-evaluated automatically.
3. **Basic auth** encodes credentials but does not encrypt — use HTTPS only.
4. **Per-request override** — `preRequest` can branch on `ctx.url` or `ctx.method`.

See [Hooks](./hooks.md) for more interceptor patterns.
