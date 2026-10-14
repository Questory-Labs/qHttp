# Testing

`@questorylabs/qhttp/testing` ships an in-memory adapter so tests never touch the network and never mock `fetch` by hand.

## MockAdapter

```typescript
import { QHttp } from '@questorylabs/qhttp';
import { MockAdapter } from '@questorylabs/qhttp/testing';

const mock = new MockAdapter()
  .get('/users/:id', (_req, { params }) => ({ body: { id: params.id, name: 'Ada' } }))
  .post('/users', async (_req, { body }) => ({ status: 201, body: await body() }))
  .once('GET', '/flaky', { status: 503 })          // first call only
  .on('GET', /^\/search\?q=/, { body: { hits: [] } }) // regex against path + query
  .delete('/users/:id', { status: 204 });

const api = new QHttp({ adapter: mock, baseUrl: 'https://api.test' });

const { data } = await api.get<User>('/users/42');
expect(mock.callsTo('GET', '/users/:id')).toHaveLength(1);
expect(mock.calls[0]?.headers.authorization).toBe('Bearer test');
```

### Replies

A reply is one of:

- `{ status?, statusText?, headers?, body?, delay? }` where `body` is JSON-encoded unless it is a string or bytes
- a `RawResponseLike` (for full control; build one with `mockResponse`)
- a function `(request, match) => reply | Promise<reply>` receiving `match.params`, `match.url` and `match.body()`

Routes match `:param` segments and `*`; absolute patterns (`https://...`) match the origin too. Unmatched requests throw with the list of registered routes, or return 404 with `new MockAdapter({ unmatched: 'notFound' })`.

### mockResponse

```typescript
import { mockResponse } from '@questorylabs/qhttp/testing';

mockResponse({ ok: true });                                  // 200 JSON
mockResponse('<xml/>', { headers: { 'content-type': 'application/xml' } });
mockResponse(new Uint8Array([1, 2, 3]));                     // octet-stream
mockResponse(undefined, { status: 204 });
```

## Testing resource hooks

Wrap components in `ResourceProvider` and drive loads through a `MockAdapter`-backed client, or pass `load` functions directly. `ResourceStore` can be inspected with `peek`, `snapshot` and `has`. Fake timers work with `gcTime`, `refreshEvery` and retry delays.

## Testing middleware

Call `compose([...])` with a stub terminal or use a client with a `MockAdapter`; assert on `mock.calls` for headers added by middleware and on `result.timing.attempts` for retries.
