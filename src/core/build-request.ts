import { QHttpError } from '../errors/qhttp-error.js';
import type { HttpMethod, QHttpConfig, QueryParams, RequestContext, RequestOptions } from './types.js';
import { appendQueryString, joinUrl } from '../utils/url.js';
import { serializeParams, mergeQueryParams } from '../utils/query.js';
import { mergeHeaders, getHeader } from '../utils/headers.js';
import { findUnresolvedMacros, resolveMacros } from '../utils/url-macros.js';
import { createRequestId, fnv1a, stableStringify } from '../utils/hash.js';

export interface BuildRequestInput {
  config: QHttpConfig;
  method: HttpMethod;
  urlOverride?: string;
  options?: RequestOptions;
}

/**
 * Merge instance config with per-call options into a request context.
 * Per-call options never mutate the config.
 */
export function buildRequestContext(input: BuildRequestInput): RequestContext {
  const { config, method, urlOverride } = input;
  const options = input.options ?? {};
  const macros = { ...config.urlMacros, ...options.macros };
  const pathTemplate = options.url ?? urlOverride ?? config.url ?? '';
  const resolvedPath = pathTemplate ? resolveMacros(pathTemplate, macros, { strict: true }) : '';

  const unresolved = findUnresolvedMacros(resolvedPath);
  if (unresolved.length > 0) {
    throw new QHttpError(`Unresolved URL macro(s): ${unresolved.join(', ')}`, {
      code: 'MISSING_URL_MACRO',
    });
  }

  const baseUrl = config.baseUrl;
  const joined = joinUrl(baseUrl, resolvedPath || '');

  const queryParams = mergeQueryParams(config.queryParams, options.params);
  const serializer = config.paramsSerializer ?? ((params) => serializeParams(params));
  const queryString = serializer(queryParams);
  const resolvedUrl = appendQueryString(joined, queryString);

  const headers = mergeHeaders(mergeHeaders(undefined, config.headers), options.headers);

  const auth = options.auth === false ? undefined : (options.auth ?? config.auth);

  return {
    requestId: createRequestId(),
    startedAt: Date.now(),
    baseUrl,
    url: pathTemplate,
    resolvedUrl,
    method,
    headers,
    queryParams,
    body: options.body ?? config.body,
    timeout: options.timeout ?? config.timeout,
    deadline: options.deadline ?? config.deadline,
    responseType: options.responseType ?? config.responseType ?? 'auto',
    signal: options.signal ?? config.signal,
    macros,
    auth,
    onProgress: options.onProgress,
    fetchOptions:
      config.fetchOptions || options.fetchOptions
        ? { ...config.fetchOptions, ...options.fetchOptions }
        : undefined,
    parse: options.parse ?? config.parse,
    validateStatus: options.validateStatus ?? config.validateStatus,
    meta: { ...config.meta, ...options.meta },
    state: { attempt: 0 },
  };
}

export function sortBodyKeys(body: unknown): unknown {
  if (Array.isArray(body)) {
    return body.map(sortBodyKeys);
  }
  if (body && typeof body === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(body as Record<string, unknown>).sort()) {
      sorted[key] = sortBodyKeys((body as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return body;
}

export const DEFAULT_CACHE_VARY = ['authorization'];

export interface CacheKeyOptions {
  paramsSerializer?: (params: QueryParams) => string;
  /** Request headers hashed into the key. Default `['authorization']`. */
  vary?: string[];
}

function bodyKeyPart(body: RequestContext['body']): string {
  if (body === undefined || body === null) return '';
  if (typeof body === 'string') return body;
  if (typeof FormData !== 'undefined' && body instanceof FormData) return '[formdata]';
  if (body instanceof URLSearchParams) return body.toString();
  if (typeof Blob !== 'undefined' && body instanceof Blob) return `[blob:${body.size}]`;
  if (body instanceof ArrayBuffer) return `[buffer:${body.byteLength}]`;
  if (ArrayBuffer.isView(body)) return `[view:${body.byteLength}]`;
  if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) return '[stream]';
  return stableStringify(body);
}

/**
 * Default cache key: `METHOD:url?params:body[#vary]`. Headers listed in `vary`
 * (Authorization by default) are hashed in so authenticated responses never
 * cross users sharing one engine.
 */
export function buildCacheKeyFromContext(
  ctx: RequestContext,
  paramsSerializerOrOptions?: ((params: QueryParams) => string) | CacheKeyOptions,
): string {
  const options: CacheKeyOptions =
    typeof paramsSerializerOrOptions === 'function'
      ? { paramsSerializer: paramsSerializerOrOptions }
      : (paramsSerializerOrOptions ?? {});
  const serializer =
    options.paramsSerializer ?? ((params) => serializeParams(params, { sort: true }));
  const params = serializer(ctx.queryParams);
  const bodyPart = bodyKeyPart(ctx.body);

  let key =
    !params && !bodyPart
      ? `${ctx.method}:${ctx.resolvedUrl}`
      : `${ctx.method}:${ctx.resolvedUrl}?${params}:${bodyPart}`;

  const vary = options.vary ?? DEFAULT_CACHE_VARY;
  const varyParts: string[] = [];
  for (const name of vary) {
    const value = getHeader(ctx.headers, name);
    if (value) varyParts.push(`${name.toLowerCase()}=${fnv1a(value)}`);
  }
  if (varyParts.length > 0) {
    key += `#${varyParts.join('&')}`;
  }
  return key;
}
