import { applyAuth } from '../auth/auth.js';
import { isReplayableBody } from '../core/body.js';
import type { AuthConfig, Middleware } from '../core/types.js';
import { isQHttpError } from '../errors/qhttp-error.js';

export interface AuthMiddlewareDeps {
  /** Shared single-flight slot so concurrent 401s trigger one refresh. */
  refreshState: { pending?: Promise<string | void> };
  /** Persist a refreshed static bearer token on the owning client. */
  onToken?: (token: string) => void;
}

/**
 * Applies credentials, then on a configured status (401 by default) runs the
 * refresh callback once per run, re-applies auth and replays the request.
 */
export function createAuthMiddleware(deps: AuthMiddlewareDeps): Middleware {
  return async (ctx, next) => {
    if (!ctx.auth) return next();

    await applyAuth(ctx, ctx.auth);

    try {
      return await next();
    } catch (error) {
      const refresh = refreshFor(ctx.auth);
      if (
        !refresh ||
        ctx.state.authRefreshed ||
        !isQHttpError(error) ||
        error.code !== 'HTTP_ERROR' ||
        !error.httpStatus ||
        !(refresh.on ?? [401]).includes(error.httpStatus) ||
        !isReplayableBody(ctx.body)
      ) {
        throw error;
      }

      const token = await singleFlight(deps.refreshState, refresh.run);
      if (typeof token === 'string' && ctx.auth.type === 'bearer') {
        ctx.auth = { ...ctx.auth, token };
        deps.onToken?.(token);
      }

      ctx.state.authRefreshed = true;
      ctx.headers.delete('authorization');
      await applyAuth(ctx, ctx.auth);
      return next(ctx);
    }
  };
}

function refreshFor(auth: AuthConfig) {
  return auth.type === 'basic' ? undefined : auth.refresh;
}

async function singleFlight(
  state: { pending?: Promise<string | void> },
  run: () => Promise<string | void>,
): Promise<string | void> {
  if (!state.pending) {
    state.pending = run().finally(() => {
      state.pending = undefined;
    });
  }
  return state.pending;
}
