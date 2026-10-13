import type { Middleware } from '../core/types.js';
import { composeSignal } from '../utils/abortable.js';

/**
 * Per-attempt timeout. Composes the request-scope signal (cancel, user
 * signal, deadline) with `ctx.timeout` so downstream sees a single signal.
 */
export const timeoutMiddleware: Middleware = async (ctx, next) => {
  if (!ctx.timeout || ctx.timeout <= 0) return next();

  const composed = composeSignal(ctx.signal, ctx.timeout);
  try {
    return await next({ ...ctx, signal: composed.signal });
  } finally {
    composed.cleanup();
  }
};
