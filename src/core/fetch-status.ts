import type { FetchStatus, QHttpResult, StateChangeHandler } from './types.js';
import type { QHttpError } from '../errors/qhttp-error.js';

export function createFetchStatusManager() {
  let status: FetchStatus = 'idle';
  const listeners = new Set<StateChangeHandler>();
  let lastResult: QHttpResult | undefined;
  let lastError: QHttpError | undefined;

  return {
    get status() {
      return status;
    },
    get lastResult() {
      return lastResult;
    },
    get lastError() {
      return lastError;
    },
    subscribe(handler: StateChangeHandler) {
      listeners.add(handler);
      return () => listeners.delete(handler);
    },
    set(next: FetchStatus, ctx: { result?: QHttpResult; error?: QHttpError } = {}) {
      status = next;
      if (ctx.result) lastResult = ctx.result;
      if (ctx.error) lastError = ctx.error;
      for (const listener of listeners) {
        listener(next, ctx);
      }
    },
    reset() {
      status = 'idle';
      lastResult = undefined;
      lastError = undefined;
    },
  };
}
