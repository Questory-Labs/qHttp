# Requests

## Base URL and paths

```typescript
client.setBaseUrl('https://api.example.com');
client.setUrl('/v1/users');

await client.get(); // GET https://api.example.com/v1/users
await client.get('/health'); // overrides path for this call only
```

Paths are joined safely — trailing slashes on the base and leading slashes on the path are normalized.

```typescript
import { joinUrl } from '@questorylabs/qhttp';

joinUrl('https://api.example.com/', '/users'); // https://api.example.com/users
```

## URL macros

Embed `{{name}}` placeholders in URLs and cache keys:

```typescript
client
  .setUrl('/users/{{userId}}/orders/{{orderId}}')
  .replaceUrlMacros({ userId: 'u1', orderId: 'o9' });

// Resolved: /users/u1/orders/o9
```

Macros must be resolved before the request runs. Missing macros throw `QHttpError` with code `MISSING_URL_MACRO`.

```typescript
import { resolveMacros, findUnresolvedMacros } from '@questorylabs/qhttp';

resolveMacros('/users/{{id}}', { id: 42 }); // '/users/42'
findUnresolvedMacros('/users/{{id}}');      // ['id']
```

## Query parameters

Set and merge params across calls:

```typescript
client.setQueryParams({ page: 1, limit: 20 });
client.setQueryParams({ sort: 'name' }); // merges with existing

await client.get('/items');
// GET .../items?page=1&limit=20&sort=name
```

Supported value types: strings, numbers, booleans, `Date`, arrays, nested objects, `null` / `undefined` (skipped).

Custom serialization:

```typescript
client.paramsSerializer((params) =>
  new URLSearchParams(params as Record<string, string>).toString(),
);
```

Or use the utility:

```typescript
import { serializeParams } from '@questorylabs/qhttp';

serializeParams({ tags: ['a', 'b'], filter: { active: true } });
```

## Headers

```typescript
client.setHeaders({
  'X-App-Version': '2.0',
  Accept: 'application/json',
});

// In preRequest — headers are a Map<string, string>
client.preRequest((ctx) => {
  ctx.headers.set('x-request-id', crypto.randomUUID());
});
```

Later `setHeaders` calls shallow-merge with prior headers.

## Request body

```typescript
// JSON object — Content-Type: application/json added automatically
await client.setBody({ name: 'Ada', role: 'admin' }).post('/users');

// Raw string
await client.setBody('plain text').post('/notes');

// FormData, URLSearchParams, Blob, ArrayBuffer, typed arrays
await client.setBody(formData).post('/upload');

// ReadableStream (Node fetch duplex)
await client.setBody(stream).post('/ingest');
```

`GET` and `HEAD` cannot carry a body — attempting to do so throws `BODY_NOT_ALLOWED`.

Clear body between calls by not reusing a client configured with a stale body, or clone:

```typescript
const base = new QHttp({ baseUrl: url });
await base.setBody({ a: 1 }).post('/a');
await base.clone().get('/b'); // no body
```

## Response types

Default `responseType` is `auto`:

| Content-Type hint | Parsed as |
|-------------------|-----------|
| `application/json` | JSON |
| `text/*` | string |
| other | `ArrayBuffer` |

Force a type:

```typescript
client.setResponseType('json');       // always JSON.parse
client.setResponseType('text');       // string
client.setResponseType('blob');       // Blob
client.setResponseType('arrayBuffer'); // ArrayBuffer
client.setResponseType('stream');     // ReadableStream (no auto-parse)
```

## Progress

`onProgress` reports both upload and download bytes. Events include `direction: 'upload' | 'download'`.

### Download

Track bytes while the response body is read:

```typescript
client.onProgress((event) => {
  if (event.direction === 'download') {
    console.log(event.loaded, event.total);
  }
});

// Requires non-stream responseType (auto/json/text/blob/arrayBuffer)
```

### Upload

QHttp wraps the request body in a `ReadableStream` (`duplex: 'half'`) and emits progress as the adapter pulls chunks:

```typescript
client
  .setBody(new Blob([largeFile]))
  .onProgress((event) => {
    if (event.direction === 'upload') {
      console.log(event.loaded, event.total);
    }
  });

await client.post('/upload');
```

| Body | `loaded` | `total` |
|------|----------|---------|
| string / JSON / Blob / ArrayBuffer / typed arrays / URLSearchParams | yes | exact (+ `Content-Length`) |
| FormData | yes (via platform `Request` serialization) | estimated from field sizes |
| opaque `ReadableStream` | yes | only if `Content-Length` is set |

Use the default fetch adapter for upload progress — `Http2Adapter` does not accept stream bodies.

## Timeouts

```typescript
client.setTimeout(5000); // ms; uses AbortController internally
```

Timeout aborts surface as `QHttpError` with code `TIMEOUT`.

## Abort signals

```typescript
const controller = new AbortController();
client.setSignal(controller.signal);

controller.abort(); // or client.cancel()
```

External signal and timeout are composed — either can abort the request.

## Guidelines

1. **Reuse clients** for shared base URL, auth, and hooks; override URL per call when needed.
2. **Resolve macros** before requests — use `replaceUrlMacros` or constructor `urlMacros`.
3. **Don't cache POST bodies** on a shared client without cloning — body sticks until changed.
4. **Type your `get<T>()`** — parsing is runtime; TypeScript types are your contract.
5. **Use `stream` responseType** when piping large downloads without buffering.

See also: [Caching](./caching.md), [Retry & errors](./retry-and-errors.md).
