# WebSockets

`@questorylabs/qhttp/ws` provides `QWebSocket`: reconnect, heartbeat, send queue, typed JSON helper and a pluggable adapter layer.

## Browser quick start

```typescript
import { QWebSocket } from '@questorylabs/qhttp/ws';

const socket = new QWebSocket('wss://example.com/socket')
  .setProtocols(['v1'])
  .setReconnect({ retries: 5, delay: 1000, backoff: 'exponential', maxDelay: 30_000, jitter: true })
  .setHeartbeat({ intervalMs: 30_000, message: 'ping', isPong: 'pong', pongTimeoutMs: 5_000 })
  .onOpen(() => console.log('connected'))
  .onMessage((msg) => console.log(msg.data))
  .onJson<ServerEvent>((event) => handle(event))
  .onError((err) => console.error(err))
  .onClose((ev) => console.log(ev.code, ev.reason))
  .onReconnect((attempt) => console.log('reconnect', attempt))
  .onReconnected((attempt) => resubscribe())
  .onStateChange((state) => setStatus(state))
  .connect();

socket.sendJson({ type: 'subscribe', channel: 'orders' });
socket.close(1000, 'done');
```

## Node (`ws` peer)

```typescript
import { QWebSocket, NodeWSAdapter } from '@questorylabs/qhttp/ws';

const adapter = await NodeWSAdapter.create();
const socket = new QWebSocket('wss://example.com/socket')
  .setAdapter(adapter)
  .setHeaders({ Authorization: 'Bearer token' })
  .connect();
```

Browsers cannot send custom headers; the browser adapter warns in development if you pass any. Use a query string, a subprotocol or the first message instead.

## Reconnect

Triggered on abnormal close codes (not `1000` / `1001`) and not after `close()`. `retries` counts consecutive attempts and resets when a connection opens. `readyState` stays `'reconnecting'` until the replacement socket opens; `onReconnected` fires then. Listeners on the old socket are detached, so late events from it are ignored. If the adapter throws while reconnecting, the error goes to `onError` and counts as a failed attempt. Calling `connect()` after the socket gave up starts a fresh count.

Some servers accept the socket, send a refusal and close. Resetting on open would then retry at the base delay forever. Pass `resetOn` a predicate to reset only once the server really accepts the connection:

```typescript
socket.setReconnect({
  retries: Infinity,
  backoff: 'exponential',
  resetOn: (event) => !String(event.data).includes('"error"'),
});
```

With a predicate, the count and `onReconnected` wait for the first message after each (re)connect for which it returns `true`. `onOpen` still fires when the socket opens. The default is `resetOn: 'open'`.

`reconnectOn` decides which close codes reconnect. The default skips `1000` and `1001`. A server that restarts may close with either, so pass `reconnectOn: () => true` to reconnect after any close except your own `close()`.

## Heartbeat

```typescript
socket.setHeartbeat({ intervalMs: 30_000, message: 'ping', pongTimeoutMs: 5_000, isPong: (d) => d === 'pong' });
```

Without `isPong`, any incoming frame resets the pong timer. On timeout the socket closes with code `4000` and reconnect (if configured) kicks in.

## Send queue and backpressure

Messages sent while not open are queued (`queueLimit`, default 100; overflow throws) and flushed on open. `socket.queuedCount` and `socket.bufferedAmount` (from the underlying socket, when exposed) help apply backpressure.

## Ready state

`'connecting' | 'open' | 'closing' | 'closed' | 'reconnecting'`, also delivered through `onStateChange`.

## Events

`on(event, fn)` / `off(event, fn)` for `open`, `message`, `error`, `close`, `reconnect`, `reconnected`, `state`.

## Custom adapter

```typescript
import type { WSAdapter, WSAdapterConnectOptions, WSAdapterSocket } from '@questorylabs/qhttp/ws';

class MyAdapter implements WSAdapter {
  connect(options: WSAdapterConnectOptions): WSAdapterSocket { /* ... */ }
}
```

## Guidelines

1. **Await `NodeWSAdapter.create()`** before `connect()` in Node.
2. **Match pongs explicitly** with `isPong` when the server is chatty.
3. **Resubscribe in `onReconnected`**, not in `onOpen`, when subscriptions are per connection.
4. **Call `close()` on teardown**; it stops reconnect loops and heartbeats.
