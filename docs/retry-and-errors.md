# Retry & errors

## Retry configuration

Enable retries with `setRetry()`. Retries only run when `retries > 0`:

```typescript
client.setRetry({
  retries: 3,
  retryDelay: 300,        // base delay ms
  backoff: 'exponential', // 'fixed' | 'exponential'
  maxDelay: 30_000,
  jitter: true,
  retryOn: (error, attempt) => {
    // optional override
    return attempt <= 2;
  },
});
```

### Default retryability

When `retryOn` is omitted, retries apply only to **idempotent methods**: `GET`, `HEAD`, `PUT`, `DELETE`, `OPTIONS`.

`POST`, `PATCH` are not retried by default (avoid duplicate side effects).

Retryable conditions by default:

| Condition | Retried? |
|-----------|----------|
| `QHttpError` code `TIMEOUT` | yes |
| `QHttpError` code `NETWORK` | yes |
| HTTP 408, 425, 429, 502, 503, 504 | yes |
| Other HTTP errors | no |
| `TypeError` (often network) | yes |

### Retry-After header

On HTTP errors, QHttp reads `Retry-After` (seconds or HTTP-date) and waits at least that long before the next attempt (capped by `maxDelay`).

### Body replay

Retries require a **replayable body** (string, JSON object, FormData, Blob, etc.). `ReadableStream` bodies are not replayed — the request runs once without retry.

## QHttpError

Thrown (or attached to `result.error`) on failures:

```typescript
import { QHttpError, isQHttpError } from '@questorylabs/qhttp';

try {
  await client.get('/x');
} catch (error) {
  if (isQHttpError(error)) {
    error.code;        // e.g. 'HTTP_ERROR'
    error.httpStatus;  // e.g. 500
    error.message;
    error.request;     // config snapshot
    error.result;      // partial result on HTTP errors
    error.cause;       // underlying error
  }
}
```

### Error codes

| Code | Meaning |
|------|---------|
| `TIMEOUT` | `setTimeout` elapsed |
| `ABORTED` | User/system abort |
| `NETWORK` | Transport failure |
| `HTTP_ERROR` | `validateStatus` rejected status |
| `PARSE_ERROR` | Response body parse failed |
| `MISSING_URL_MACRO` | Unresolved `{{macro}}` |
| `UNSERIALIZABLE_PARAM` | Query param could not serialize |
| `BODY_NOT_ALLOWED` | Body on GET/HEAD |
| `BODY_NOT_REPLAYABLE` | *(reserved)* Stream bodies skip retry and run once — not thrown today |
| `INVALID_CONFIG` | Invalid client configuration |

## validateStatus

Default: status in `[200, 299)` is success.

```typescript
client.validateStatus((status) => status === 404 || status < 300);

const result = await client.get('/users/missing');
// 404 treated as success
```

Failed validation throws `HTTP_ERROR` with `error.result` containing parsed body when available.

## throwOnError

```typescript
const client = new QHttp({ throwOnError: false });

const result = await client.get('/fail');
if (result.error) {
  console.log(result.error.code, result.fetchStatus);
}
```

When `false`, failed requests return a result with `fetchStatus: 'error'` and `error` set instead of throwing.

## Cancel and timeout

Both produce abort errors:

```typescript
client.setTimeout(1000);
client.cancel();

// QHttpError: code TIMEOUT or ABORTED
```

## Guidelines

1. **Use jitter** in production retry configs to avoid thundering herds.
2. **Custom `retryOn`** for POST when your API is idempotent (e.g. upsert by id).
3. **Log in `onRetry`** — correlate attempt count with upstream outages.
4. **Combine with `onError`** for graceful degradation after retries exhaust.
5. **Inspect `error.result`** on HTTP errors — body may be parsed before status validation failed.

## ResourceStore / useResource

Load retries and poll backoff are **separate** from HTTP `setRetry`:

| Layer | API | Default | Purpose |
|-------|-----|---------|---------|
| HTTP | `client.setRetry({ retries })` | off | Transport / status retries |
| Resource load | `retries` on `ensure` / `useResource` | **off** (`false`) | Extra attempts around `load()` |
| Polling | `refreshEvery` | off | Interval refresh; backs off and stops after 5 failures |

Prefer **one** retry owner. If `sessionHttp` already retries, keep resource `retries: false` (the default).

```typescript
// HTTP owns retries
const http = new QHttp().setRetry({ retries: 2, backoff: 'exponential', jitter: true });

useResource({
  id: ['me'],
  load: () => http.get('/auth/me').then((r) => r.data),
  // retries omitted → false
  refreshEvery: 30_000, // poll backs off / stops on repeated failure
  refreshOnFocus: true,  // only if stale or errored; 60s cooldown
});
```

`refreshOnFocus` uses `visibilitychange` + `focus`, skips fresh data within `freshFor`, and applies a 60s cooldown between focus-driven reloads.
