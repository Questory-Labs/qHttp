import type CachePolicy from 'http-cache-semantics';
import { QHttpError } from '../errors/qhttp-error.js';
import type {
  HttpCacheEntry,
  HttpCacheOptions,
  QHttpResult,
  RequestContext,
} from '../core/types.js';
import { headersToRecord } from '../utils/headers.js';
import { toFinalRequest } from '../core/body.js';
import type { ProgressEvent } from '../core/types.js';

type CachePolicyConstructor = typeof import('http-cache-semantics');

let cachePolicyModule: CachePolicyConstructor | undefined;

export function resetHttpCacheSemanticsForTests(): void {
  cachePolicyModule = undefined;
}

export async function loadHttpCacheSemantics(): Promise<CachePolicyConstructor> {
  if (cachePolicyModule) return cachePolicyModule;
  try {
    const mod = await import('http-cache-semantics');
    const ctor = (mod as { default?: CachePolicyConstructor }).default ?? mod;
    cachePolicyModule = ctor as CachePolicyConstructor;
    return cachePolicyModule;
  } catch {
    throw new QHttpError(
      'http-cache-semantics is required for HTTP cache mode. Install it: pnpm add http-cache-semantics',
      { code: 'INVALID_CONFIG' },
    );
  }
}

export function isHttpCacheEntry(value: unknown): value is HttpCacheEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as HttpCacheEntry).kind === 'http' &&
    (value as HttpCacheEntry).v === 1
  );
}

function toLowercaseHeaders(headers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    result[key.toLowerCase()] = value;
  }
  return result;
}

function headersFromPolicy(headers: CachePolicy.Headers): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    result[key] = Array.isArray(value) ? value.join(', ') : value;
  }
  return result;
}

function toPolicyOptions(options?: HttpCacheOptions): CachePolicy.Options {
  return {
    shared: options?.shared ?? false,
    cacheHeuristic: options?.cacheHeuristic,
    immutableMinTimeToLive: options?.immutableMinTimeToLive,
    ignoreCargoCult: options?.ignoreCargoCult,
  };
}

export function buildPolicyRequest(ctx: RequestContext): CachePolicy.HttpRequest {
  return {
    url: ctx.resolvedUrl,
    method: ctx.method,
    headers: toLowercaseHeaders(headersToRecord(ctx.headers)),
  };
}

export function buildPolicyResponse(
  result: Pick<QHttpResult, 'httpStatus' | 'headers'>,
): CachePolicy.HttpResponse {
  return {
    status: result.httpStatus,
    headers: toLowercaseHeaders(result.headers),
  };
}

export async function createHttpCacheEntry(
  ctx: RequestContext,
  result: Pick<QHttpResult, 'data' | 'httpStatus' | 'statusText' | 'headers'>,
  options?: HttpCacheOptions,
): Promise<{ entry: HttpCacheEntry; ttlMs: number } | undefined> {
  const CachePolicyCtor = await loadHttpCacheSemantics();
  const policy = new CachePolicyCtor(
    buildPolicyRequest(ctx),
    buildPolicyResponse(result),
    toPolicyOptions(options),
  );

  if (!policy.storable()) return undefined;

  return {
    entry: {
      v: 1,
      kind: 'http',
      data: result.data,
      httpStatus: result.httpStatus,
      statusText: result.statusText,
      headers: result.headers,
      policy: policy.toObject(),
    },
    ttlMs: Math.max(policy.timeToLive(), 0),
  };
}

export type HttpCacheLookup =
  | { action: 'miss' }
  | { action: 'hit'; entry: HttpCacheEntry; headers: Record<string, string> }
  | {
      action: 'revalidate';
      entry: HttpCacheEntry;
      policy: CachePolicy;
      revalidationHeaders: CachePolicy.Headers;
    }
  | {
      action: 'swr';
      entry: HttpCacheEntry;
      headers: Record<string, string>;
      policy: CachePolicy;
      revalidationHeaders: CachePolicy.Headers;
    };

export async function lookupHttpCacheEntry(
  entry: HttpCacheEntry,
  ctx: RequestContext,
  _options?: HttpCacheOptions,
): Promise<HttpCacheLookup> {
  const CachePolicyCtor = await loadHttpCacheSemantics();
  const policy = CachePolicyCtor.fromObject(entry.policy as CachePolicy.CachePolicyObject);
  const request = buildPolicyRequest(ctx);

  if (policy.satisfiesWithoutRevalidation(request)) {
    return {
      action: 'hit',
      entry,
      headers: headersFromPolicy(policy.responseHeaders()),
    };
  }

  const { revalidation, response } = policy.evaluateRequest(request);

  if (response && revalidation && !revalidation.synchronous) {
    return {
      action: 'swr',
      entry,
      headers: headersFromPolicy(response.headers),
      policy,
      revalidationHeaders: revalidation.headers,
    };
  }

  if (response && !revalidation) {
    return {
      action: 'hit',
      entry,
      headers: headersFromPolicy(response.headers),
    };
  }

  if (revalidation) {
    return {
      action: 'revalidate',
      entry,
      policy,
      revalidationHeaders: revalidation.headers,
    };
  }

  return { action: 'miss' };
}

export function applyRevalidationHeaders(
  ctx: RequestContext,
  revalidationHeaders: Record<string, string | string[] | undefined>,
): void {
  for (const [key, value] of Object.entries(revalidationHeaders)) {
    if (value === undefined) continue;
    ctx.headers.set(key.toLowerCase(), Array.isArray(value) ? value.join(', ') : value);
  }
}

export interface HttpRevalidationContext {
  entry: HttpCacheEntry;
  policy: CachePolicy;
}

export interface RevalidatedHttpCacheResult {
  entry: HttpCacheEntry;
  data: unknown;
  httpStatus: number;
  statusText: string;
  headers: Record<string, string>;
  ttlMs: number;
  fromCache: boolean;
}

export async function processRevalidationResponse(
  revalidation: HttpRevalidationContext,
  ctx: RequestContext,
  response: Pick<QHttpResult, 'data' | 'httpStatus' | 'statusText' | 'headers'>,
): Promise<RevalidatedHttpCacheResult> {
  const revalidationRequest = buildPolicyRequest(ctx);
  const revalidationResponse = buildPolicyResponse(response);

  const { policy: updatedPolicy, modified } = revalidation.policy.revalidatedPolicy(
    revalidationRequest,
    revalidationResponse,
  );

  const data = modified ? response.data : revalidation.entry.data;
  const httpStatus = modified ? response.httpStatus : revalidation.entry.httpStatus;
  const statusText = modified ? response.statusText : revalidation.entry.statusText;
  const headers = headersFromPolicy(updatedPolicy.responseHeaders());
  const ttlMs = updatedPolicy.storable() ? Math.max(updatedPolicy.timeToLive(), 0) : 0;

  const entry: HttpCacheEntry = {
    v: 1,
    kind: 'http',
    data,
    httpStatus,
    statusText,
    headers: modified ? response.headers : revalidation.entry.headers,
    policy: updatedPolicy.toObject(),
  };

  return {
    entry,
    data,
    httpStatus,
    statusText,
    headers,
    ttlMs,
    fromCache: !modified,
  };
}

export function hydrateHttpCacheResult<T>(
  entry: HttpCacheEntry,
  headers: Record<string, string>,
  ctx: RequestContext,
  progressHandler?: (event: ProgressEvent) => void,
): QHttpResult<T> {
  return {
    data: entry.data as T,
    httpStatus: entry.httpStatus,
    statusText: entry.statusText,
    headers,
    ok: entry.httpStatus >= 200 && entry.httpStatus < 300,
    request: toFinalRequest(
      ctx.resolvedUrl,
      ctx.method,
      ctx.headers,
      ctx.body,
      ctx.signal,
      progressHandler,
    ),
    fetchStatus: 'success',
    fromCache: true,
  };
}
