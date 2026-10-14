import type { FinalRequest, QHttpResult, RequestContext, RequestTiming } from './types.js';

export interface MakeResultInput<T> {
  data: T;
  httpStatus: number;
  statusText: string;
  headers: Record<string, string>;
  request: FinalRequest;
  fromCache: boolean;
  response?: Response;
  ok?: boolean;
}

export function timingFor(ctx: RequestContext, endedAt = Date.now()): RequestTiming {
  return {
    startedAt: ctx.startedAt,
    endedAt,
    durationMs: Math.max(0, endedAt - ctx.startedAt),
    attempts: Math.max(1, ctx.state.attempt),
  };
}

export function makeResult<T>(ctx: RequestContext, input: MakeResultInput<T>): QHttpResult<T> {
  return {
    data: input.data,
    httpStatus: input.httpStatus,
    statusText: input.statusText,
    headers: input.headers,
    ok: input.ok ?? (input.httpStatus >= 200 && input.httpStatus < 300),
    response: input.response,
    request: input.request,
    fetchStatus: 'success',
    fromCache: input.fromCache,
    requestId: ctx.requestId,
    timing: timingFor(ctx),
  };
}
