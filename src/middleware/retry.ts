import { isReplayableBody } from '../core/body.js';
import type { Middleware, RetryOptions } from '../core/types.js';
import type { HookManager } from '../interceptors/hook-manager.js';
import { withDefaults, withRetry } from '../retry/retry.js';

export interface RetryMiddlewareDeps {
  retry?: RetryOptions | false;
  hooks: HookManager;
}

/** Retries the downstream chain per policy. Bodies that cannot be replayed are never retried. */
export function createRetryMiddleware(deps: RetryMiddlewareDeps): Middleware {
  const policy = deps.retry === false ? undefined : withDefaults(deps.retry);

  return (ctx, next) => {
    const attempt = () => {
      ctx.state.attempt += 1;
      return next();
    };

    if (!policy || !isReplayableBody(ctx.body)) {
      return attempt();
    }

    return withRetry(attempt, {
      ...policy,
      method: ctx.method,
      signal: ctx.signal,
      onRetry: async (n, error) => {
        await deps.hooks.run('onRetry', { attempt: n, error, ctx });
      },
    });
  };
}
