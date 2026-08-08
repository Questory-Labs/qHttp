# Adapters

HTTP transport is pluggable via the `HttpAdapter` interface. QHttp builds a `FinalRequest` and parses the `RawResponseLike` return value — adapters only handle wire I/O.

## Default: FetchAdapter

All environments with `fetch` use `FetchAdapter` automatically:

```typescript
import { QHttp, FetchAdapter, defaultFetchAdapter } from '@questorylabs/qhttp';

// implicit
const client = new QHttp();

// explicit
const client = new QHttp().setAdapter(defaultFetchAdapter);
```

`FetchAdapter` passes through to global `fetch` with standard `Request` options.

## HTTP/2 (Node)

Optional entry point — uses Node `http2` module:

```typescript
import { QHttp } from '@questorylabs/qhttp';
import { Http2Adapter } from '@questorylabs/qhttp/http2';

const client = new QHttp().setAdapter(new Http2Adapter());

await client.get('https://api.example.com/v1/items');
```

### HTTP/2 body support

Supported request bodies: string, Buffer, ArrayBuffer, typed arrays, Blob, `URLSearchParams`.

**Not supported:** `FormData`, `ReadableStream` — use `FetchAdapter` for those.

## Custom adapter

Implement `HttpAdapter`:

```typescript
import type { HttpAdapter, RawResponseLike, FinalRequest } from '@questorylabs/qhttp';

class LoggingAdapter implements HttpAdapter {
  constructor(private inner: HttpAdapter) {}

  async send(request: FinalRequest): Promise<RawResponseLike> {
    console.log(request.method, request.url);
    return this.inner.send(request);
  }
}

const client = new QHttp().setAdapter(
  new LoggingAdapter(defaultFetchAdapter),
);
```

### RawResponseLike

Your adapter must return an object compatible with:

```typescript
interface RawResponseLike {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Headers | Record<string, string>;
  body: ReadableStream<Uint8Array> | null;
  arrayBuffer(): Promise<ArrayBuffer>;
  json(): Promise<unknown>;
  text(): Promise<string>;
  blob(): Promise<Blob>;
}
```

QHttp uses `body` for progress tracking; fallback methods parse when the stream is consumed.

## Testing with a mock adapter

```typescript
import type { HttpAdapter, RawResponseLike } from '@questorylabs/qhttp';

function mockJson(data: unknown): RawResponseLike {
  const json = JSON.stringify(data);
  const bytes = new TextEncoder().encode(json);
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json' },
    body: new ReadableStream({
      start(c) {
        c.enqueue(bytes);
        c.close();
      },
    }),
    arrayBuffer: async () => bytes.buffer,
    json: async () => data,
    text: async () => json,
    blob: async () => new Blob([json]),
  };
}

class MockAdapter implements HttpAdapter {
  async send() {
    return mockJson({ ok: true });
  }
}

const client = new QHttp({ adapter: new MockAdapter() });
```

## Guidelines

1. **Default fetch** is enough for most apps — adapters are for HTTP/2, proxies, or telemetry wrappers.
2. **Wrap, don't fork** — decorate `defaultFetchAdapter` instead of reimplementing fetch.
3. **HTTP/2** — one connection per origin is handled inside `Http2Adapter`; reuse the client instance.
4. **No HTTP/3 in core** — bring your own adapter if you need QUIC.
5. **Adapters are per client** — different clients can use different transports.

See [WebSockets](./websockets.md) for the separate WS adapter system.
