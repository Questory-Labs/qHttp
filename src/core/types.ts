import type { QHttpError } from '../errors/qhttp-error.js';

export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS';

export type ResponseType =
  | 'auto'
  | 'json'
  | 'text'
  | 'blob'
  | 'arrayBuffer'
  | 'stream';

export type FetchStatus = 'idle' | 'loading' | 'success' | 'error';

export type QueryValue =
  | string
  | number
  | boolean
  | Date
  | null
  | undefined
  | QueryValue[]
  | { [key: string]: QueryValue };

export type QueryParams = Record<string, QueryValue>;

export type HeadersInit = Record<string, string | undefined>;

export type AuthConfig =
  | { type: 'bearer'; token: string }
  | { type: 'basic'; username: string; password: string };

export type BackoffStrategy = 'fixed' | 'exponential';

export interface RetryOptions {
  retries?: number;
  backoff?: BackoffStrategy;
  retryDelay?: number;
  maxDelay?: number;
  jitter?: boolean;
  retryOn?: (error: unknown, attempt: number) => boolean;
}

export type RequestBody =
  | string
  | Record<string, unknown>
  | unknown[]
  | FormData
  | URLSearchParams
  | Blob
  | ArrayBuffer
  | ArrayBufferView
  | ReadableStream<Uint8Array>;

export type CacheMode = 'ttl' | 'http';

export interface HttpCacheOptions {
  shared?: boolean;
  cacheHeuristic?: number;
  immutableMinTimeToLive?: number;
  ignoreCargoCult?: boolean;
}

export interface QHttpConfig {
  baseUrl?: string;
  url?: string;
  method?: HttpMethod;
  headers?: HeadersInit;
  queryParams?: QueryParams;
  body?: RequestBody;
  timeout?: number;
  responseType?: ResponseType;
  adapter?: HttpAdapter;
  retry?: RetryOptions;
  cache?: boolean;
  cacheMode?: CacheMode;
  cacheTTL?: number;
  cacheEngine?: CacheEngine;
  cacheKey?: string | ((ctx: RequestContext) => string);
  cacheWhen?: (ctx: RequestContext, result?: QHttpResult) => boolean;
  cacheMethods?: HttpMethod[];
  httpCache?: HttpCacheOptions;
  auth?: AuthConfig;
  signal?: AbortSignal;
  throwOnError?: boolean;
  validateStatus?: (httpStatus: number) => boolean;
  paramsSerializer?: (params: QueryParams) => string;
  urlMacros?: Record<string, string | number>;
}

export interface RequestContext {
  baseUrl?: string;
  url: string;
  resolvedUrl: string;
  method: HttpMethod;
  headers: Map<string, string>;
  queryParams: QueryParams;
  body?: RequestBody;
  timeout?: number;
  responseType: ResponseType;
  signal?: AbortSignal;
  macros: Record<string, string | number>;
  auth?: AuthConfig;
  onProgress?: (event: ProgressEvent) => void;
  duplex?: 'half';
}

export interface ProgressEvent {
  loaded: number;
  total?: number;
  direction: 'upload' | 'download';
}

export interface FinalRequest {
  url: string;
  method: HttpMethod;
  headers: Record<string, string>;
  body?: BodyInit | null;
  signal?: AbortSignal;
  duplex?: 'half';
}

export interface RawResponseLike {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Headers | Record<string, string>;
  body: ReadableStream<Uint8Array> | null;
  arrayBuffer: () => Promise<ArrayBuffer>;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
  blob: () => Promise<Blob>;
}

export interface HttpAdapter {
  send(request: FinalRequest): Promise<RawResponseLike>;
}

export interface QHttpResult<T = unknown> {
  data: T;
  httpStatus: number;
  statusText: string;
  headers: Record<string, string>;
  ok: boolean;
  response?: Response;
  request: FinalRequest;
  fetchStatus: FetchStatus;
  fromCache: boolean;
  error?: QHttpError;
}

export interface CacheSnapshot {
  data: unknown;
  httpStatus: number;
  statusText: string;
  headers: Record<string, string>;
}

export interface HttpCacheEntry {
  v: 1;
  kind: 'http';
  data: unknown;
  httpStatus: number;
  statusText: string;
  headers: Record<string, string>;
  policy: object;
}

export interface CacheEngine {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  deleteByPrefix?(prefix: string): Promise<void>;
}

export type StateChangeHandler = (
  status: FetchStatus,
  ctx: { result?: QHttpResult; error?: QHttpError },
) => void;

export type PreRequestHook = (
  ctx: RequestContext,
) => void | Partial<RequestContext> | Promise<void | Partial<RequestContext>>;

export type PostRequestHook = (
  payload: { result: QHttpResult; ctx: RequestContext },
) =>
  | void
  | Partial<{ result: QHttpResult; ctx: RequestContext }>
  | Promise<void | Partial<{ result: QHttpResult; ctx: RequestContext }>>;

export type ErrorHook = (
  error: QHttpError,
) => void | QHttpResult | Promise<void | QHttpResult>;

export type RetryHook = (payload: { attempt: number; error: unknown }) => void | Promise<void>;

export type HookPhase =
  | 'preRequest'
  | 'postRequest'
  | 'onError'
  | 'onRetry'
  | 'preCache'
  | 'postCache'
  | (string & {});

export type HookFn = (ctx: unknown) => unknown | Promise<unknown>;
