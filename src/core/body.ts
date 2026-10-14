import { QHttpError } from '../errors/qhttp-error.js';
import type {
  FetchOptions,
  FinalRequest,
  HttpMethod,
  ProgressEvent,
  RawResponseLike,
  RequestBody,
  ResponseType,
} from './types.js';
import { hasHeader, setHeader } from '../utils/headers.js';
import { wrapBodyWithUploadProgress, type SerializedBody } from './upload-progress.js';

export type { SerializedBody };
export { wrapBodyWithUploadProgress };

export function serializeRequestBody(
  method: HttpMethod,
  body: RequestBody | undefined,
  headers: Map<string, string>,
): SerializedBody {
  if (body === undefined || body === null) {
    return { body: undefined };
  }

  if (method === 'GET' || method === 'HEAD') {
    throw new QHttpError('Request body is not allowed for GET/HEAD requests', {
      code: 'BODY_NOT_ALLOWED',
    });
  }

  if (typeof body === 'string') {
    return { body };
  }

  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    return { body };
  }

  if (body instanceof URLSearchParams) {
    return { body };
  }

  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    return { body };
  }

  if (body instanceof ArrayBuffer) {
    return { body };
  }

  if (ArrayBuffer.isView(body)) {
    return { body: body as BodyInit };
  }

  if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) {
    return { body, duplex: 'half' };
  }

  if (typeof body === 'object') {
    if (!hasHeader(headers, 'content-type')) {
      setHeader(headers, 'content-type', 'application/json');
    }
    return { body: JSON.stringify(body) };
  }

  return { body: String(body) };
}

export function isReplayableBody(body: RequestBody | undefined): boolean {
  if (body === undefined || body === null) return true;
  if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) {
    return false;
  }
  return true;
}

export async function readResponseWithProgress(
  response: RawResponseLike,
  onProgress?: (event: ProgressEvent) => void,
): Promise<ArrayBuffer | null> {
  if (!response.body) {
    return null;
  }

  const totalHeader =
    response.headers instanceof Headers
      ? response.headers.get('content-length')
      : (response.headers['content-length'] ?? response.headers['Content-Length']);
  const total = totalHeader ? Number(totalHeader) : undefined;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress?.({ loaded, total, direction: 'download' });
  }

  if (chunks.length === 0) return null;

  const combined = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined.buffer;
}

export function readContentType(headers: Headers | Record<string, string>): string {
  if (headers && typeof (headers as Headers).get === 'function') {
    const value = (headers as Headers).get('content-type');
    if (value) return value;
  }
  const record = headers as Record<string, string>;
  return record['content-type'] ?? record['Content-Type'] ?? '';
}

export async function parseResponseBody<T>(
  response: RawResponseLike,
  responseType: ResponseType,
  bufferedBody?: ArrayBuffer | null,
): Promise<T> {
  const contentType = readContentType(response.headers);

  const effectiveType =
    responseType === 'auto' ? sniffResponseType(contentType, response.status) : responseType;

  if (effectiveType === 'stream') {
    if (!response.body) {
      return undefined as T;
    }
    return response.body as T;
  }

  if (response.status === 204 || response.status === 205 || response.status === 304) {
    return undefined as T;
  }

  if (bufferedBody !== undefined) {
    if (bufferedBody === null) return undefined as T;
    return parseBufferedBody<T>(bufferedBody, effectiveType, contentType);
  }

  switch (effectiveType) {
    case 'json': {
      // Read as text first so empty bodies become `undefined` instead of a parse error.
      const text = await response.text();
      if (!text) return undefined as T;
      try {
        return JSON.parse(text) as T;
      } catch (cause) {
        throw new QHttpError('Failed to parse JSON response', {
          code: 'PARSE_ERROR',
          httpStatus: response.status,
          cause,
        });
      }
    }
    case 'text':
      return (await response.text()) as T;
    case 'blob':
      return (await response.blob()) as T;
    case 'arrayBuffer':
      return (await response.arrayBuffer()) as T;
    default:
      return undefined as T;
  }
}

const TEXT_LIKE = [
  'text/',
  'application/xml',
  'application/xhtml+xml',
  'application/javascript',
  'application/ecmascript',
  'application/x-www-form-urlencoded',
  'application/graphql',
  'application/sql',
  'application/yaml',
  'application/x-yaml',
  'application/toml',
  'image/svg+xml',
];

export function sniffResponseType(contentType: string, status: number): ResponseType {
  if (status === 204 || status === 205 || status === 304) return 'text';
  const type = contentType.toLowerCase();
  if (type.includes('json')) return 'json';
  if (type.endsWith('+xml') || type.endsWith('+yaml')) return 'text';
  if (TEXT_LIKE.some((prefix) => type.startsWith(prefix))) return 'text';
  if (!type) return 'text';
  return 'arrayBuffer';
}

function parseBufferedBody<T>(
  buffer: ArrayBuffer,
  responseType: ResponseType,
  contentType: string,
): T {
  const effectiveType =
    responseType === 'auto' ? sniffResponseType(contentType, 200) : responseType;

  if (effectiveType === 'arrayBuffer') {
    return buffer as T;
  }

  if (effectiveType === 'blob') {
    return new Blob([buffer], contentType ? { type: contentType } : undefined) as T;
  }

  const text = new TextDecoder().decode(buffer);

  if (effectiveType === 'json') {
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch (cause) {
      throw new QHttpError('Failed to parse JSON response', {
        code: 'PARSE_ERROR',
        cause,
      });
    }
  }

  return text as T;
}

export function assertProgressCompatible(responseType: ResponseType, hasProgress: boolean): void {
  if (hasProgress && responseType === 'stream') {
    throw new QHttpError('onProgress is incompatible with responseType "stream"', {
      code: 'INVALID_CONFIG',
    });
  }
}

export function isBinaryResponseType(responseType: ResponseType): boolean {
  return responseType === 'blob' || responseType === 'arrayBuffer' || responseType === 'stream';
}

export interface ToFinalRequestInput {
  url: string;
  method: HttpMethod;
  headers: Map<string, string>;
  body?: RequestBody;
  signal?: AbortSignal;
  onUploadProgress?: (event: ProgressEvent) => void;
  init?: FetchOptions;
}

export function toFinalRequest(input: ToFinalRequestInput): FinalRequest {
  const { url, method, headers, body, signal, onUploadProgress, init } = input;
  const serialized = serializeRequestBody(method, body, headers);

  if (onUploadProgress && serialized.body != null) {
    const wrapped = wrapBodyWithUploadProgress(serialized.body, headers, onUploadProgress);
    if (wrapped) {
      return {
        url,
        method,
        headers: Object.fromEntries(headers),
        body: wrapped.body,
        signal,
        duplex: wrapped.duplex,
        init,
      };
    }
  }

  return {
    url,
    method,
    headers: Object.fromEntries(headers),
    body: serialized.body,
    signal,
    duplex: serialized.duplex,
    init,
  };
}

/** Request summary without serializing the body (cache hits, failures). */
export function toRequestSummary(input: Omit<ToFinalRequestInput, 'onUploadProgress'>): FinalRequest {
  return {
    url: input.url,
    method: input.method,
    headers: Object.fromEntries(input.headers),
    signal: input.signal,
    init: input.init,
  };
}
