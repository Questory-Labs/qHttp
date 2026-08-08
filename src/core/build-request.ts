import { QHttpError } from '../errors/qhttp-error.js';
import type { HttpMethod, QHttpConfig, QueryParams, RequestContext } from './types.js';
import { appendQueryString, joinUrl } from '../utils/url.js';
import { serializeParams } from '../utils/query.js';
import { mergeHeaders } from '../utils/headers.js';
import { findUnresolvedMacros, resolveMacros } from '../utils/url-macros.js';

export interface BuildRequestInput {
  config: QHttpConfig;
  method: HttpMethod;
  urlOverride?: string;
}

export function buildRequestContext(input: BuildRequestInput): RequestContext {
  const { config, method, urlOverride } = input;
  const macros = { ...config.urlMacros };
  const pathTemplate = urlOverride ?? config.url ?? '';
  const resolvedPath = pathTemplate
    ? resolveMacros(pathTemplate, macros, { strict: true })
  : '';

  const unresolved = findUnresolvedMacros(resolvedPath);
  if (unresolved.length > 0) {
    throw new QHttpError(`Unresolved URL macro(s): ${unresolved.join(', ')}`, {
      code: 'MISSING_URL_MACRO',
    });
  }

  const baseUrl = config.baseUrl;
  const pathUrl = resolvedPath || '';
  const joined = joinUrl(baseUrl, pathUrl);

  const serializer = config.paramsSerializer ?? ((params) => serializeParams(params));
  const queryString = serializer(config.queryParams ?? {});
  const resolvedUrl = appendQueryString(joined, queryString);

  const headers = mergeHeaders(undefined, config.headers);

  return {
    baseUrl,
    url: pathTemplate,
    resolvedUrl,
    method,
    headers,
    queryParams: config.queryParams ?? {},
    body: config.body,
    timeout: config.timeout,
    responseType: config.responseType ?? 'auto',
    signal: config.signal,
    macros,
    auth: config.auth,
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

export function buildCacheKeyFromContext(
  ctx: RequestContext,
  paramsSerializer?: (params: QueryParams) => string,
): string {
  const serializer = paramsSerializer ?? ((params) => serializeParams(params, { sort: true }));
  const params = serializer(ctx.queryParams);
  const bodyPart =
    ctx.body && typeof ctx.body === 'object' && !(ctx.body instanceof FormData)
      ? JSON.stringify(sortBodyKeys(ctx.body))
      : ctx.body
        ? String(ctx.body)
        : '';
  if (!params && !bodyPart) {
    return `${ctx.method}:${ctx.resolvedUrl}`;
  }
  return `${ctx.method}:${ctx.resolvedUrl}?${params}:${bodyPart}`;
}
