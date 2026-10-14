import type { Middleware, Next, QHttpResult, RequestContext } from './types.js';

/**
 * Compose middleware into one middleware. Each step receives `next`, which
 * runs the remainder of the chain and finally `terminal`. `next(otherCtx)`
 * runs downstream with a different context (used by stale-while-revalidate
 * and auth refresh).
 */
export function compose(middleware: readonly Middleware[]): Middleware {
  return (ctx: RequestContext, terminal: Next): Promise<QHttpResult> => {
    const dispatch = (index: number, current: RequestContext): Promise<QHttpResult> => {
      const fn = middleware[index];
      if (!fn) {
        return terminal(current);
      }
      const next: Next = (override?: RequestContext) => dispatch(index + 1, override ?? current);
      return fn(current, next);
    };
    return dispatch(0, ctx);
  };
}

/** Adapt a terminal middleware (one that never calls `next`) into a `Next`. */
export function asTerminal(terminal: Middleware): Next {
  const end: Next = () => Promise.reject(new Error('qhttp: no middleware after transport'));
  return (ctx?: RequestContext) => {
    if (!ctx) return end();
    return terminal(ctx, end);
  };
}
