import type { HttpMethod, QHttpResult, RequestContext } from '../core/types.js';

export type QHttpErrorCode =
  | 'TIMEOUT'
  | 'DEADLINE'
  | 'ABORTED'
  | 'NETWORK'
  | 'HTTP_ERROR'
  | 'PARSE_ERROR'
  | 'VALIDATION_ERROR'
  | 'MISSING_URL_MACRO'
  | 'UNSERIALIZABLE_PARAM'
  | 'BODY_NOT_ALLOWED'
  | 'BODY_NOT_REPLAYABLE'
  | 'CIRCUIT_OPEN'
  | 'INVALID_CONFIG';

/** Redacted request summary attached to errors. Never carries credentials or bodies. */
export interface QHttpErrorRequest {
  requestId?: string;
  url?: string;
  baseUrl?: string;
  resolvedUrl?: string;
  method?: HttpMethod;
  timeout?: number;
  headers?: Record<string, string>;
  urlMacros?: Record<string, string | number>;
}

export interface ValidationIssue {
  message: string;
  path?: ReadonlyArray<unknown>;
}

export interface QHttpErrorOptions {
  code?: QHttpErrorCode;
  httpStatus?: number;
  response?: Response;
  request?: QHttpErrorRequest;
  cause?: unknown;
  result?: Partial<QHttpResult>;
  issues?: ReadonlyArray<ValidationIssue>;
}

export class QHttpError extends Error {
  readonly code: QHttpErrorCode;
  readonly httpStatus?: number;
  readonly response?: Response;
  readonly request?: QHttpErrorRequest;
  override readonly cause?: unknown;
  readonly result?: Partial<QHttpResult>;
  readonly issues?: ReadonlyArray<ValidationIssue>;

  constructor(message: string, options: QHttpErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'QHttpError';
    this.code = options.code ?? 'NETWORK';
    this.httpStatus = options.httpStatus;
    this.response = options.response;
    this.request = options.request;
    this.cause = options.cause;
    this.result = options.result;
    this.issues = options.issues;
  }

  /** Alias of `httpStatus` for code that expects `error.status`. */
  get status(): number | undefined {
    return this.httpStatus;
  }

  get requestId(): string | undefined {
    return this.request?.requestId;
  }

  /** Parsed response body for HTTP errors, when available. */
  get data(): unknown {
    return this.result?.data;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      httpStatus: this.httpStatus,
      requestId: this.requestId,
      request: this.request,
      issues: this.issues,
    };
  }
}

export function isQHttpError(error: unknown): error is QHttpError {
  if (error instanceof QHttpError) return true;
  // Tolerate duplicate module instances (dual package hazard).
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'QHttpError' &&
    typeof (error as { code?: unknown }).code === 'string'
  );
}

export function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException) return error.name === 'AbortError';
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
]);

export function redactHeaders(
  headers: Map<string, string> | Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  const entries = headers instanceof Map ? headers.entries() : Object.entries(headers);
  for (const [key, value] of entries) {
    out[key] = SENSITIVE_HEADERS.has(key.toLowerCase()) ? '[redacted]' : value;
  }
  return out;
}

/** Redacted request summary for errors: no auth, no body. */
export function contextToConfig(ctx: RequestContext): QHttpErrorRequest {
  return {
    requestId: ctx.requestId,
    url: ctx.url,
    baseUrl: ctx.baseUrl,
    resolvedUrl: ctx.resolvedUrl,
    method: ctx.method,
    timeout: ctx.timeout,
    headers: redactHeaders(ctx.headers),
    urlMacros: ctx.macros,
  };
}
