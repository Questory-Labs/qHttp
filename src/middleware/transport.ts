import {
  parseResponseBody,
  readResponseWithProgress,
  toFinalRequest,
} from '../core/body.js';
import { makeResult } from '../core/result.js';
import type {
  HttpAdapter,
  Middleware,
  RawResponseLike,
  RequestContext,
  ResponseParser,
  StandardSchema,
} from '../core/types.js';
import { contextToConfig, isAbortError, isQHttpError, QHttpError } from '../errors/qhttp-error.js';
import { readAbortReason, type AbortReason } from '../utils/abortable.js';
import { recordToHeaders } from '../utils/headers.js';

export function abortErrorFor(reason: AbortReason | undefined, ctx: RequestContext, cause?: unknown) {
  const code = reason ?? 'ABORTED';
  const message =
    code === 'TIMEOUT'
      ? 'Request timed out'
      : code === 'DEADLINE'
        ? 'Request deadline exceeded'
        : 'Request aborted';
  return new QHttpError(message, { code, request: contextToConfig(ctx), cause });
}

export function transportError(cause: unknown, ctx: RequestContext): QHttpError {
  if (isQHttpError(cause)) return cause;
  if (isAbortError(cause)) {
    return abortErrorFor(readAbortReason(ctx.signal), ctx, cause);
  }
  return new QHttpError('Network request failed', {
    code: 'NETWORK',
    request: contextToConfig(ctx),
    cause,
  });
}

function isStandardSchema(parser: ResponseParser): parser is StandardSchema {
  return typeof parser === 'object' && parser !== null && '~standard' in parser;
}

export async function runParser<T>(
  parser: ResponseParser<T>,
  data: unknown,
  ctx: RequestContext,
  httpStatus: number,
): Promise<T> {
  if (isStandardSchema(parser)) {
    const outcome = await parser['~standard'].validate(data);
    if (outcome.issues) {
      throw new QHttpError('Response failed schema validation', {
        code: 'VALIDATION_ERROR',
        httpStatus,
        request: contextToConfig(ctx),
        issues: outcome.issues.map((issue) => ({ message: issue.message, path: issue.path })),
        result: { data },
      });
    }
    return outcome.value;
  }
  try {
    return await parser(data);
  } catch (cause) {
    if (isQHttpError(cause)) throw cause;
    throw new QHttpError('Response failed validation', {
      code: 'VALIDATION_ERROR',
      httpStatus,
      request: contextToConfig(ctx),
      cause,
      result: { data },
    });
  }
}

/** Terminal middleware: serialize, send through the adapter, parse and validate. */
export function createTransport(adapter: HttpAdapter): Middleware {
  return async (ctx) => {
    const finalRequest = toFinalRequest({
      url: ctx.resolvedUrl,
      method: ctx.method,
      headers: ctx.headers,
      body: ctx.body,
      signal: ctx.signal,
      onUploadProgress: ctx.onProgress,
      init: ctx.fetchOptions,
    });

    let raw: RawResponseLike;
    try {
      raw = await adapter.send(finalRequest);
    } catch (cause) {
      throw transportError(cause, ctx);
    }

    const headers = recordToHeaders(raw.headers);
    const revalidating = ctx.state.httpRevalidate !== undefined;

    if (revalidating && raw.status === 304) {
      return makeResult(ctx, {
        data: undefined,
        httpStatus: 304,
        statusText: raw.statusText,
        headers,
        request: finalRequest,
        fromCache: false,
        response: raw.raw,
        ok: true,
      });
    }

    let bufferedBody: ArrayBuffer | null | undefined;
    let data: unknown;
    try {
      if (ctx.onProgress && raw.body) {
        bufferedBody = await readResponseWithProgress(raw, ctx.onProgress);
      }
      data = await parseResponseBody(raw, ctx.responseType, bufferedBody);
    } catch (cause) {
      throw transportError(cause, ctx);
    }

    const result = makeResult(ctx, {
      data,
      httpStatus: raw.status,
      statusText: raw.statusText,
      headers,
      request: finalRequest,
      fromCache: false,
      response: raw.raw,
      ok: raw.ok,
    });

    const validate = ctx.validateStatus ?? ((s: number) => s >= 200 && s < 300);
    if (!validate(raw.status)) {
      throw new QHttpError(`Request failed with status ${raw.status}`, {
        code: 'HTTP_ERROR',
        httpStatus: raw.status,
        request: contextToConfig(ctx),
        response: raw.raw,
        result,
      });
    }

    if (ctx.parse) {
      result.data = await runParser(ctx.parse, data, ctx, raw.status);
    }

    return result;
  };
}
