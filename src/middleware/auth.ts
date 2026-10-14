import { applyAuth } from '../auth/auth.js';
import { isReplayableBody } from '../core/body.js';
import type { AuthConfig, Middleware } from '../core/types.js';
import { isQHttpError } from '../errors/qhttp-error.js';

export interface AuthMiddlewareDeps {
  /**
   * Shared single-flight slots keyed by refresh callback, so concurrent 401s
   * for one credential trigger one refresh and other credentials never share it.
   */
  refreshState: Map<RefreshRun, Promise<string | void>>;
  /** Persist a refreshed bearer token; `auth` is the config that was refreshed. */
  onToken?: (token: string, auth: AuthConfig) => void;
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

      const auth = ctx.auth;
      const token = await singleFlight(deps.refreshState, refresh.run);
      if (typeof token === 'string' && auth.type === 'bearer') {
        ctx.auth = { ...auth, token };
        deps.onToken?.(token, auth);
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

type RefreshRun = () => Promise<string | void>;

async function singleFlight(
  state: Map<RefreshRun, Promise<string | void>>,
  run: RefreshRun,
): Promise<string | void> {
  let pending = state.get(run);
  if (!pending) {
    pending = run().finally(() => {
      state.delete(run);
    });
    state.set(run, pending);
  }
  return pending;
}
