# Requests

## Base URL and paths

```typescript
client.setBaseUrl('https://api.example.com');
client.setUrl('/v1/users');

await client.get();                          // GET https://api.example.com/v1/users
await client.get('/health');                 // overrides path for this call only
await client.get('https://other.example/x'); // absolute URLs bypass baseUrl
```

Paths are joined safely; trailing and leading slashes are normalized.

```typescript
import { joinUrl, isAbsoluteUrl } from '@questorylabs/qhttp';
joinUrl('https://api.example.com/', '/users'); // https://api.example.com/users
```

## URL macros

```typescript
client.setUrl('/users/{{userId}}/orders/{{orderId}}').replaceUrlMacros({ userId: 'u1' });

await client.get(undefined, { macros: { orderId: 'o9' } }); // /users/u1/orders/o9
```

Missing macros throw `QHttpError` with code `MISSING_URL_MACRO`. Values are URI-encoded.

## Query parameters

```typescript
client.setQueryParams({ page: 1, limit: 20 });        // instance defaults, merged across calls
await client.get('/items', { params: { sort: 'name' } }); // merged for this call only
// GET .../items?page=1&limit=20&sort=name
```

Supported values: strings, numbers, booleans, `Date` (ISO), arrays (repeated keys), `null` / `undefined` (skipped). Nested objects throw `UNSERIALIZABLE_PARAM`; use `paramsSerializer` for bracket or comma formats.

## Headers

```typescript
client.setHeaders({ 'X-App-Version': '2.0' });
await client.get('/x', { headers: { 'x-trace': id } });

client.preRequest((ctx) => {
  ctx.headers.set('x-request-id', ctx.requestId); // Map with lowercase keys
});
```

Set a header to `undefined` to remove an instance default.

## Request body

```typescript
await client.post('/users', { body: { name: 'Ada' } });   // JSON, content-type added
await client.post('/notes', { body: 'plain text' });
await client.post('/upload', { body: formData });          // multipart
await client.post('/form', { body: new URLSearchParams({ a: '1' }) });
await client.post('/bin', { body: new Blob([bytes]) });
await client.post('/ingest', { body: readableStream });    // duplex: 'half'; never retried
```

`GET` and `HEAD` cannot carry a body (`BODY_NOT_ALLOWED`). Prefer per-call `body` over `setBody` on shared clients so bodies never leak between calls.

## Response types

Default `responseType: 'auto'`:

| Content-Type | Parsed as |
|--------------|-----------|
| `*json*` | JSON (empty body → `undefined`) |
| `text/*`, XML, SVG, YAML, JavaScript, form-urlencoded, missing | string |
| anything else | `ArrayBuffer` |

Force a type per client or per call: `'json' | 'text' | 'blob' | 'arrayBuffer' | 'stream'`.

```typescript
const { data } = await client.get<ReadableStream>('/big', { responseType: 'stream' });
```

## Validation

`parse` accepts a [Standard Schema](https://standardschema.dev) (zod, valibot, arktype and others) or a plain function. It runs after `validateStatus` and before the result is cached.

```typescript
import { z } from 'zod';

const User = z.object({ id: z.string(), name: z.string() });

const { data } = await client.get('/users/u1', { parse: User }); // data: { id: string; name: string }

client.parse((raw) => normalize(raw)); // instance default
```

Failures throw `VALIDATION_ERROR` with `error.issues` and the raw body on `error.data`.

## Fetch options

Anything `fetch` accepts beyond method, headers, body and signal:

```typescript
client.setFetchOptions({ credentials: 'include', cache: 'no-store' });
await client.get('/x', { fetchOptions: { priority: 'high', keepalive: true } });
```

On Node, pass an undici `dispatcher` for connection pooling or proxies. Custom adapters receive these as `request.init`.

## Progress

`onProgress` reports upload and download bytes with `direction`.

```typescript
await client.post('/upload', {
  body: new Blob([largeFile]),
  onProgress: (e) => setPercent(e.direction === 'upload' ? e.loaded / (e.total ?? 1) : 1),
});
```

| Body | `loaded` | `total` |
|------|----------|---------|
| string / JSON / Blob / ArrayBuffer / typed arrays / URLSearchParams | yes | exact |
| FormData | yes | estimated |
| opaque `ReadableStream` | yes | only with `Content-Length` |

Download progress requires a non-stream `responseType`. Use the fetch adapter; `Http2Adapter` does not accept stream bodies.

## Timeouts and deadline

```typescript
client.setTimeout(5_000);   // per attempt → TIMEOUT
client.setDeadline(20_000); // whole request including retries → DEADLINE
```

## Abort

```typescript
const controller = new AbortController();
await client.get('/x', { signal: controller.signal });
controller.abort(); // → ABORTED

client.cancel();    // aborts every in-flight request on this instance
```

## Pagination

`paginate` returns an async iterable of results plus `.items()` and `.all()`:

```typescript
import { pageParam, cursorParam, linkHeader } from '@questorylabs/qhttp';

const pages = client.paginate<Page>({
  url: '/orders',
  params: { page: 1, limit: 50 },
  next: pageParam({ hasMore: (r) => r.data.hasMore }),
  maxPages: 100,
});

for await (const order of pages.items((p) => p.items)) handle(order);

await client.paginate<Feed>({ url: '/feed', next: cursorParam({ getCursor: (r) => r.data.nextCursor }) }).all();
await client.paginate<Repo[]>({ url: '/repos', next: linkHeader() }).all(); // RFC 8288 Link: rel="next"
```

`next` receives the last result and page number and returns the options for the next page, or a falsy value to stop.

## Dedupe

```typescript
client.dedupe(); // identical concurrent GET/HEAD/OPTIONS share one response
await Promise.all([client.get('/me'), client.get('/me')]); // one network call
```

## Guidelines

1. **Reuse clients**, override per call. Cloning is only needed to fork hooks or middleware.
2. **Prefer per-call `body`** over `setBody` on shared clients.
3. **Validate at the edge** with `parse` on responses you render or store.
4. **Set a deadline** on user-facing calls that also retry.
5. **Use `stream` responseType** when piping large downloads without buffering.

See also: [Caching](./caching.md), [Retry & errors](./retry-and-errors.md).
