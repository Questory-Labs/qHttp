# Adapters

Transport is pluggable via `HttpAdapter`. QHttp builds a `FinalRequest` and parses the `RawResponseLike` the adapter returns; adapters only handle wire I/O.

## FetchAdapter (default)

```typescript
import { QHttp, FetchAdapter } from '@questorylabs/qhttp';

const client = new QHttp(); // global fetch

const session = new QHttp().setAdapter(
  new FetchAdapter({ defaults: { credentials: 'include', cache: 'no-store' } }),
);

const undiciClient = new QHttp().setAdapter(new FetchAdapter({ fetch: undici.fetch }));
```

Fetch init fields reach the adapter through `request.init`; set them with `setFetchOptions` or per-call `fetchOptions`. The native `Response` is exposed as `result.response`.

## HTTP/2 (Node)

```typescript
import { Http2Adapter } from '@questorylabs/qhttp/http2';

const client = new QHttp().setAdapter(
  new Http2Adapter({ sessionIdleMs: 60_000, connectOptions: { ca } }),
);
```

One session per origin, closed after `sessionIdleMs` of inactivity. Connection-specific headers (`connection`, `transfer-encoding`, `host`, ...) are stripped. Supported bodies: string, Buffer, ArrayBuffer, typed arrays, Blob, `URLSearchParams`. `FormData` and `ReadableStream` are rejected; responses are buffered.

## Custom adapter

```typescript
import type { HttpAdapter, FinalRequest, RawResponseLike } from '@questorylabs/qhttp';
import { wrapFetchResponse, defaultFetchAdapter } from '@questorylabs/qhttp';

class LoggingAdapter implements HttpAdapter {
  constructor(private inner: HttpAdapter = defaultFetchAdapter) {}

  async send(request: FinalRequest): Promise<RawResponseLike> {
    console.log(request.method, request.url, request.init);
    return this.inner.send(request);
  }
}
```

### FinalRequest

| Field | Notes |
|-------|-------|
| `url`, `method`, `headers` | Headers as a plain lowercase record |
| `body` | `BodyInit`, possibly a progress-wrapped `ReadableStream` |
| `signal` | Composed abort signal; honour it |
| `duplex` | `'half'` when the body is a stream |
| `init` | Fetch passthrough (`credentials`, `cache`, `dispatcher`, ...) |

### RawResponseLike

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
  raw?: Response; // optional native response
}
```

`wrapFetchResponse(response)` builds one from a `Response`. QHttp reads `body` for progress tracking and falls back to the methods otherwise.

Throw a `DOMException` named `AbortError` when `signal` fires so the client reports `TIMEOUT`, `DEADLINE` or `ABORTED` correctly.

## Testing

Use `MockAdapter` from `@questorylabs/qhttp/testing`; see [Testing](./testing.md).

## Guidelines

1. **Default fetch** covers most apps; adapters are for HTTP/2, proxies, telemetry or tests.
2. **Wrap, don't fork**: decorate `defaultFetchAdapter`.
3. **Adapters are per client**; share instances when they hold connections (`Http2Adapter`).
4. **No HTTP/3 in core**; bring your own adapter for QUIC.
