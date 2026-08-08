# WebSockets

WebSocket support lives in `@questorylabs/qhttp/ws` via `QWebSocket` — a chainable client with reconnect, heartbeat, and a pluggable adapter layer (mirroring HTTP adapters).

## Browser quick start

```typescript
import { QWebSocket } from '@questorylabs/qhttp/ws';

const socket = new QWebSocket('wss://example.com/socket')
  .setProtocols(['v1'])
  .setReconnect({ retries: 5, delay: 1000, backoff: 'exponential', maxDelay: 30_000 })
  .setHeartbeat({ intervalMs: 30_000, message: 'ping', pongTimeoutMs: 5_000 })
  .onOpen(() => console.log('connected'))
  .onMessage((msg) => console.log(msg.data))
  .onError((err) => console.error(err))
  .onClose((ev) => console.log(ev.code, ev.reason))
  .onReconnect((attempt) => console.log('reconnect', attempt))
  .connect();

socket.sendJson({ type: 'subscribe', channel: 'orders' });
socket.send('raw string');
socket.close(1000, 'done');
```

Default adapter: `BrowserWSAdapter` (native `WebSocket`).

## Node (`ws` peer)

Install the optional peer:

```bash
pnpm add ws
```

Create the adapter before connecting:

```typescript
import { QWebSocket, NodeWSAdapter } from '@questorylabs/qhttp/ws';

const adapter = await NodeWSAdapter.create();

const socket = new QWebSocket('wss://example.com/socket')
  .setAdapter(adapter)
  .setHeaders({ Authorization: 'Bearer token' }) // Node only — not in browser
  .connect();
```

`NodeWSAdapter.create()` dynamically imports `ws` so browser bundles stay lean.

Deprecated helper (still works):

```typescript
import { createNodeWSSocket } from '@questorylabs/qhttp/ws';
const raw = await createNodeWSSocket({ url: 'wss://...', headers: {} });
```

Prefer `NodeWSAdapter.create()` + `QWebSocket`.

## Reconnect

```typescript
socket.setReconnect({
  retries: 5,           // max attempts after unclean close
  delay: 1000,          // base delay ms
  backoff: 'exponential', // or 'fixed'
  maxDelay: 30_000,
});
```

Reconnect triggers on abnormal close codes — not on clean close (`1000`, `1001`).

## Heartbeat

```typescript
socket.setHeartbeat({
  intervalMs: 30_000,
  message: 'ping',      // string or ArrayBuffer
  pongTimeoutMs: 5_000, // close if no message received
});
```

Any incoming message resets the pong timer — not only literal `pong` replies.

## Send queue

Messages sent while disconnected are queued (default limit: 100). Queue overflows throw.

```typescript
new QWebSocket(url, { queueLimit: 50 });
```

Queue flushes on `open`.

## Ready state

```typescript
socket.readyState;
// 'connecting' | 'open' | 'closing' | 'closed' | 'reconnecting'
```

## Event subscription

```typescript
socket.onMessage(handler);
socket.off('message', handler); // unsubscribe
```

## Custom WS adapter

```typescript
import type { WSAdapter, WSAdapterConnectOptions } from '@questorylabs/qhttp/ws';

class MyAdapter implements WSAdapter {
  connect(options: WSAdapterConnectOptions) {
    // return WSAdapterSocket with addEventListener, send, close, readyState
  }
}

socket.setAdapter(new MyAdapter());
```

See `BrowserWSAdapter` and `NodeWSAdapter` for reference implementations.

## Guidelines

1. **Await `NodeWSAdapter.create()`** before `connect()` in Node — avoids race on dynamic import.
2. **Use `sendJson`** for structured messages — handles `JSON.stringify`.
3. **Heartbeat + reconnect** together for long-lived dashboards and live feeds.
4. **Call `close()`** on teardown — sets manual close flag and stops reconnect loops.
5. **Headers on Node** — only via `setHeaders` + `NodeWSAdapter`; browsers cannot set arbitrary WS headers.

## HTTP + WS together

```typescript
import { QHttp } from '@questorylabs/qhttp';
import { QWebSocket, NodeWSAdapter } from '@questorylabs/qhttp/ws';

const api = new QHttp({ baseUrl: 'https://api.example.com' });
const { data } = await api
  .post('/auth/login')
  .setBody({ user, pass })
  .get<{ token: string }>();

const adapter = await NodeWSAdapter.create();

new QWebSocket('wss://stream.example.com')
  .setAdapter(adapter)
  .setHeaders({ Authorization: `Bearer ${data.token}` })
  .onMessage((msg) => console.log(msg.data))
  .connect();
```

In the browser, auth for WebSockets usually goes in the query string or first message — `setHeaders` is Node-only.
