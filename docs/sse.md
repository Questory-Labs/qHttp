# Server-Sent Events

`@questorylabs/qhttp/sse` provides `QEventSource`, a fetch-based SSE client. Unlike the browser `EventSource` it supports custom headers, credentials, `POST` bodies, Node, reconnect policy and async iteration.

## Quick start

```typescript
import { QEventSource } from '@questorylabs/qhttp/sse';

const source = new QEventSource('https://api.example.com/stream', {
  headers: { authorization: `Bearer ${token}` },
  fetchOptions: { credentials: 'include' },
  reconnect: { retries: 10, delay: 1_000, backoff: 'exponential', maxDelay: 30_000, jitter: true },
})
  .onOpen(() => console.log('connected'))
  .onMessage((m) => console.log(m.event, m.data, m.id))
  .onEvent('order', (m) => handleOrder(JSON.parse(m.data)))
  .onJson<Tick>((tick) => update(tick), 'tick')
  .onError((e) => console.warn(e))
  .onReconnect((attempt) => console.log('reconnecting', attempt))
  .onStateChange((s) => setStatus(s))
  .connect();

source.close();
```

## Messages

```typescript
interface SseMessage {
  event: string;   // 'message' when the stream did not name one
  data: string;    // multi-line data joined with '\n'
  id?: string;
  retry?: number;  // server-suggested reconnect delay (ms)
}
```

## Reconnect

After a dropped or ended stream the client waits (server `retry:` value if sent, else the policy) and reconnects with `Last-Event-ID` set to the last id seen. `retries` counts consecutive failures; a successful connection resets it. 4xx responses other than 429 stop reconnecting. Pass `reconnect: false` to disable.

## Async iteration

```typescript
for await (const message of new QEventSource(url)) {
  if (message.event === 'done') break;
}
```

## Callback helper

```typescript
import { subscribeSse } from '@questorylabs/qhttp/sse';

const ac = new AbortController();
subscribeSse(url, { onMessage: (m) => push(m.data), onEvent: { tick: onTick } }, ac.signal);
ac.abort(); // closes the source
```

This is the shape `useLiveResource` expects; see [React](./react.md#useliveresource) for the `sse` shortcut.

## POST streams

```typescript
new QEventSource('/chat', { method: 'POST', body: JSON.stringify(prompt), headers: { 'content-type': 'application/json' } });
```

## Parser

`createSseParser(onMessage)` is exported for custom transports; feed it chunks with `push(text)` and call `end()` at EOF.

## Guidelines

1. **Set `reconnect.retries`** generously for dashboards; consecutive failures reset on success.
2. **Use named events** instead of encoding the type inside `data`.
3. **Prefer `onJson`** with an event filter for typed payloads.
4. **Close on unmount** (or bind to a signal via `subscribeSse`).
