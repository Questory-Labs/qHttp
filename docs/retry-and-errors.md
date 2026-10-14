# Retry & errors

## Retry

```typescript
client.setRetry({
  retries: 3,
  retryDelay: 300,        // base delay ms
  backoff: 'exponential', // 'fixed' | 'exponential'
  maxDelay: 30_000,
  jitter: true,           // equal jitter: 50–100% of the computed delay
  retryOn: (error, attempt) => attempt <= 2, // optional override
});

await client.post('/orders', { body, retry: { retries: 2, retryOn: () => true } }); // per call
await client.get('/once', { retry: false });
```

Defaults when `retryOn` is omitted: only idempotent methods (`GET`, `HEAD`, `PUT`, `DELETE`, `OPTIONS`) retry, on `TIMEOUT`, `NETWORK`, and HTTP 408, 425, 429, 502, 503, 504. `Retry-After` (seconds or HTTP-date) is honoured, capped by `maxDelay`. Stream bodies are never retried. `DEADLINE`, `ABORTED` and `CIRCUIT_OPEN` are never retried.

## Timeout vs deadline

| Setting | Scope | Error code |
|---------|-------|------------|
| `setTimeout(ms)` / `timeout` | Each attempt | `TIMEOUT` (retryable) |
| `setDeadline(ms)` / `deadline` | Whole call including backoff sleeps | `DEADLINE` |

## Rate limiting

Per-origin token bucket and concurrency cap, applied per attempt:

```typescript
import { RateLimiter } from '@questorylabs/qhttp';

const limiter = new RateLimiter({ requestsPerSecond: 10, burst: 20, concurrency: 4 });
tmdb.rateLimit(limiter);
trakt.rateLimit(limiter); // shared budget
```

Waiting for a slot counts against the per-attempt timeout.

## Circuit breaker

```typescript
import { CircuitBreaker } from '@questorylabs/qhttp';

client.circuitBreaker({ failureThreshold: 5, resetAfterMs: 30_000 });
```

After `failureThreshold` consecutive failures (`NETWORK`, `TIMEOUT`, 5xx by default; customize with `isFailure`) the origin's circuit opens and calls fail fast with `CIRCUIT_OPEN`. After `resetAfterMs` one trial request is allowed; success closes the circuit, failure reopens it. Share a `CircuitBreaker` instance across clients to share state; `breaker.stateOf(origin)` and `breaker.reset()` are available for dashboards and tests.

## QHttpError

```typescript
import { isQHttpError } from '@questorylabs/qhttp';

try {
  await client.get('/x');
} catch (error) {
  if (isQHttpError(error)) {
    error.code;        // 'HTTP_ERROR'
    error.httpStatus;  // 500 (also error.status)
    error.data;        // parsed error body when available
    error.result;      // partial result on HTTP errors
    error.request;     // redacted summary: url, method, headers (auth masked), requestId
    error.requestId;
    error.issues;      // VALIDATION_ERROR only
    error.cause;
  }
}
```

`error.request` never contains credentials or request bodies. `JSON.stringify(error)` also includes `issues`, which can echo values from the response body, so don't assume a serialized error is safe to log when responses may carry sensitive data.

### Error codes

| Code | Meaning |
|------|---------|
| `TIMEOUT` | Per-attempt timeout elapsed |
| `DEADLINE` | Overall deadline elapsed |
| `ABORTED` | `cancel()` or user signal |
| `NETWORK` | Transport failure |
| `HTTP_ERROR` | `validateStatus` rejected the status |
| `PARSE_ERROR` | Body parse failed |
| `VALIDATION_ERROR` | `parse` schema or function rejected the body |
| `CIRCUIT_OPEN` | Circuit breaker refused the call |
| `MISSING_URL_MACRO` | Unresolved `{{macro}}` |
| `UNSERIALIZABLE_PARAM` | Nested object in query params |
| `BODY_NOT_ALLOWED` | Body on GET/HEAD |
| `BODY_NOT_REPLAYABLE` | Reserved |
| `INVALID_CONFIG` | Invalid configuration or missing optional peer |

## validateStatus and throwOnError

```typescript
client.validateStatus((s) => s === 404 || s < 300);

const result = await client.get('/fail', { throwOnError: false });
result.error?.code; result.httpStatus; result.data; result.headers;
```

## Resource layer retries

HTTP retries and resource retries are separate layers. Keep one owner:

| Layer | API | Default |
|-------|-----|---------|
| HTTP | `client.setRetry` | off |
| Resource load | `retries` on `useResource` / `ensure` | off |
| Polling | `refreshEvery` | off; backs off and stops after 5 failures |

See [React](./react.md).

## Guidelines

1. **Jitter on** in production.
2. **Deadline on** for user-facing calls that retry.
3. **Share limiters and breakers** per upstream, not per client instance.
4. **Log `requestId`** from results and errors to correlate with server logs.
