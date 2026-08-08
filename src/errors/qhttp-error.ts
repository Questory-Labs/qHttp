import type { QHttpConfig, QHttpResult, RequestContext } from '../core/types.js';

export type QHttpErrorCode =
  | 'TIMEOUT'
  | 'ABORTED'
  | 'NETWORK'
  | 'HTTP_ERROR'
  | 'PARSE_ERROR'
  | 'MISSING_URL_MACRO'
  | 'UNSERIALIZABLE_PARAM'
  | 'BODY_NOT_ALLOWED'
  | 'BODY_NOT_REPLAYABLE'
  | 'INVALID_CONFIG';

export interface QHttpErrorOptions {
  code?: QHttpErrorCode;
  httpStatus?: number;
  response?: Response;
  request?: QHttpConfig;
  cause?: unknown;
  result?: Partial<QHttpResult>;
}

export class QHttpError extends Error {
  readonly code: QHttpErrorCode;
  readonly httpStatus?: number;
  readonly response?: Response;
  readonly request?: QHttpConfig;
  readonly cause?: unknown;
  readonly result?: Partial<QHttpResult>;

  constructor(message: string, options: QHttpErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'QHttpError';
    this.code = options.code ?? 'NETWORK';
    this.httpStatus = options.httpStatus;
    this.response = options.response;
    this.request = options.request;
    this.cause = options.cause;
    this.result = options.result;
  }
}

export function isQHttpError(error: unknown): error is QHttpError {
  return error instanceof QHttpError;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function contextToConfig(ctx: RequestContext): QHttpConfig {
  return {
    url: ctx.url,
    baseUrl: ctx.baseUrl,
    method: ctx.method,
    body: ctx.body,
    timeout: ctx.timeout,
    urlMacros: ctx.macros,
    auth: ctx.auth,
  };
}
