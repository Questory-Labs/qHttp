# React resource layer

`@questorylabs/qhttp/react` ships a framework-agnostic `ResourceStore` and thin hooks on top of it. It is deliberately smaller than TanStack Query: ids, loads, freshness, invalidation, push, and a few hooks.

## Provider

```tsx
import { ResourceProvider } from '@questorylabs/qhttp/react';

<ResourceProvider defaults={{ freshFor: 30_000, gcTime: 5 * 60_000, retries: false }}>
  <App />
</ResourceProvider>
```

Pass `store` to share one `ResourceStore` across roots, and `hydrate` with the output of `store.dehydrate()` from the server.

## useResource

```tsx
const user = useResource({
  id: ['user', userId],
  load: () => api.get<User>(`/users/${userId}`).then((r) => r.data),
  // or: request: api.clone().setUrl(`/users/${userId}`)
  when: Boolean(userId),
  freshFor: 60_000,
  gcTime: 10 * 60_000,
  refreshEvery: (value) => (value?.pending ? 2_000 : false),
  refreshOnFocus: true,
  keepPrevious: true,
  retries: false,
});

user.value; user.empty; user.busy; user.refreshing; user.failed; user.ready; user.error;
user.placeholder; // true while showing the previous id's value
await user.reload();
```

- `load` identity does not matter; inline lambdas are fine.
- Ids are compared structurally with sorted object keys.
- The entry reloads when it is dropped from the store (`store.drop()`), with no remount needed.
- Entries without observers are collected after `gcTime` (default 5 min; `Infinity` keeps forever).

## useAction

```tsx
const rename = useAction({
  run: (name: string) => api.patch('/me', { body: { name } }).then((r) => r.data),
  optimistic: (name) => [[['me'], (prev) => ({ ...(prev as Me), name })]],
  touches: [['me'], ['dashboard']],
  onSuccess: (data, input) => toast('Saved'),
  onError: (error) => toast(error.message),
  onSettled: () => analytics.track('rename'),
});

rename.submit('Ada');          // fire and forget
await rename.submitAsync('B'); // awaitable, rejects on failure
rename.busy; rename.failed; rename.succeeded; rename.error; rename.value; rename.input; rename.reset();
```

Optimistic updates apply immediately through `store.push` and roll back if `run` throws. `touches` marks resources stale after success; observed ones reload at once.

## useLiveResource

Initial load plus push updates from SSE, WebSocket or anything else:

```tsx
const status = useLiveResource<SyncStatus>({
  id: ['sync-status'],
  load: () => api.get<SyncStatus>('/sync-status').then((r) => r.data),
  sse: { url: `${apiUrl}/sync-status/stream`, withCredentials: true, event: 'status' },
  // or: subscribe: (onEvent, signal) => socket.onJson(onEvent, signal)
  parse: JSON.parse,
  merge: (prev, incoming) => ({ ...prev, ...incoming }),
});
```

The subscription is opened once per id and torn down on unmount. A push that arrives while the initial load is in flight wins over the load result.

## useSuspenseResource

```tsx
function Profile() {
  const me = useSuspenseResource({ id: ['me'], load: fetchMe }); // value is never undefined
  return <h1>{me.value.name}</h1>;
}

<Suspense fallback={<Spinner />}><Profile /></Suspense>
```

Errors throw to the nearest error boundary.

## usePagedResource

```tsx
const feed = usePagedResource<FeedPage, string>({
  id: ['feed'],
  loadPage: (cursor) => api.get<FeedPage>('/feed', { params: { cursor } }).then((r) => r.data),
  nextCursor: (page) => page.nextCursor,
});

feed.pages; feed.hasMore; feed.loadingMore; feed.loadMoreError;
await feed.loadMore();
await feed.reload(); // refetches every page already loaded
```

## ResourceStore directly

```typescript
import { ResourceStore } from '@questorylabs/qhttp/resource';

const store = new ResourceStore({ freshFor: 30_000 });
await store.ensure(['me'], fetchMe);           // load if stale/missing, dedupes concurrent calls
await store.reload(['me']);                    // force
store.push(['me'], user);                      // set from outside (sockets, forms)
store.update<Me>(['me'], (prev) => ({ ...prev!, seen: true }));
store.touch(['orders']);                       // stale + reload observed matches (prefix match)
store.drop(['orders', 42]);                    // remove; observers reload
store.peek(['me']); store.snapshot(['me']); store.has(['me']);
const off = store.observe(['me'], () => render());
store.subscribe((id) => devtools.log(id));
const data = store.dehydrate(); store.hydrate(data);
```

## SSR

```tsx
// server
const store = new ResourceStore();
await store.ensure(['me'], fetchMe);
const dehydrated = store.dehydrate();

// client
<ResourceProvider hydrate={dehydrated}><App /></ResourceProvider>
```

## Retries and polling

Resource `retries` default to `false`; let the HTTP client own retries. `refreshEvery` backs off exponentially on consecutive failures and stops after five; focus or `reload()` resumes it. `refreshOnFocus` reloads only stale or failed resources, with a 60s cooldown.
