# Changelog

## 0.2.1

- Resource load retries: exponential backoff, `retries` / `false` (default off — use HTTP `setRetry`)
- `refreshEvery` poll backoff via `RefreshScheduler` (stops after consecutive failures)
- Stable `load` identity (inline lambdas no longer re-fetch every render)
- `reload` forces refetch; `cancel()` works during retry backoff; Http2 respects abort
