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
| `BODY_NOT_REPLAYABLE` | Stream body with retry |
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
