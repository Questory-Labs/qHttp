import type { ProgressEvent } from './types.js';
import { hasHeader, setHeader, getHeader } from '../utils/headers.js';

export interface SerializedBody {
  body?: BodyInit | null;
  duplex?: 'half';
}

const UPLOAD_CHUNK_SIZE = 64 * 1024;
const FORM_PROBE_URL = 'http://qhttp.local/';

/**
 * Wrap request bodies so adapters that pull a ReadableStream emit upload progress.
 * FormData uses the platform Request serializer (axios fetch-adapter approach).
 * Opaque streams report `loaded`; `total` comes from Content-Length when set.
 */
export function wrapBodyWithUploadProgress(
  body: BodyInit,
  headers: Map<string, string>,
  onProgress: (event: ProgressEvent) => void,
): SerializedBody | undefined {
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    return wrapFormDataWithUploadProgress(body, headers, onProgress);
  }

  if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) {
    const total = readContentLength(headers);
    return wrapStreamWithUploadProgress(body, onProgress, total);
  }

  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
    return wrapBytesWithUploadProgress(
      new TextEncoder().encode(body.toString()),
      headers,
      onProgress,
      'application/x-www-form-urlencoded;charset=UTF-8',
    );
  }

  if (typeof body === 'string') {
    return wrapBytesWithUploadProgress(new TextEncoder().encode(body), headers, onProgress);
  }

  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    return wrapBlobWithUploadProgress(body, headers, onProgress);
  }

  if (body instanceof ArrayBuffer) {
    return wrapBytesWithUploadProgress(new Uint8Array(body), headers, onProgress);
  }

  if (ArrayBuffer.isView(body)) {
    return wrapBytesWithUploadProgress(
      new Uint8Array(body.buffer, body.byteOffset, body.byteLength),
      headers,
      onProgress,
    );
  }

  return undefined;
}

function wrapFormDataWithUploadProgress(
  form: FormData,
  headers: Map<string, string>,
  onProgress: (event: ProgressEvent) => void,
): SerializedBody | undefined {
  if (typeof Request === 'undefined' || typeof ReadableStream === 'undefined') {
    return undefined;
  }

  let request: Request;
  try {
    request = new Request(FORM_PROBE_URL, {
      method: 'POST',
      body: form,
      duplex: 'half',
    } as RequestInit);
  } catch {
    try {
      request = new Request(FORM_PROBE_URL, { method: 'POST', body: form });
    } catch {
      return undefined;
    }
  }

  if (!request.body) return undefined;

  const contentType = request.headers.get('content-type');
  if (contentType && !hasHeader(headers, 'content-type')) {
    setHeader(headers, 'content-type', contentType);
  }

  // Estimate only for progress UI — do not set Content-Length (multipart must stay exact).
  const total = estimateFormDataLength(form);
  return wrapStreamWithUploadProgress(request.body, onProgress, total);
}

function wrapBytesWithUploadProgress(
  bytes: Uint8Array,
  headers: Map<string, string>,
  onProgress: (event: ProgressEvent) => void,
  defaultContentType?: string,
): SerializedBody {
  ensureContentLength(headers, bytes.byteLength);
  if (defaultContentType && !hasHeader(headers, 'content-type')) {
    setHeader(headers, 'content-type', defaultContentType);
  }

  let offset = 0;
  const total = bytes.byteLength;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= total) {
        controller.close();
        return;
      }
      const end = Math.min(offset + UPLOAD_CHUNK_SIZE, total);
      const chunk = bytes.subarray(offset, end);
      offset = end;
      onProgress({ loaded: offset, total, direction: 'upload' });
      controller.enqueue(chunk);
    },
  });

  return { body: stream, duplex: 'half' };
}

function wrapBlobWithUploadProgress(
  blob: Blob,
  headers: Map<string, string>,
  onProgress: (event: ProgressEvent) => void,
): SerializedBody {
  const total = blob.size;
  ensureContentLength(headers, total);
  if (blob.type && !hasHeader(headers, 'content-type')) {
    setHeader(headers, 'content-type', blob.type);
  }
  return wrapStreamWithUploadProgress(blob.stream(), onProgress, total);
}

function wrapStreamWithUploadProgress(
  source: ReadableStream<Uint8Array>,
  onProgress: (event: ProgressEvent) => void,
  total?: number,
): SerializedBody {
  const reader = source.getReader();
  let loaded = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      loaded += value.byteLength;
      onProgress({ loaded, total, direction: 'upload' });
      controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });

  return { body: stream, duplex: 'half' };
}

/** Rough multipart size for progress percent — not used as Content-Length. */
function estimateFormDataLength(form: FormData): number | undefined {
  if (typeof form.entries !== 'function') return undefined;

  const encoder = new TextEncoder();
  let total = 0;
  for (const [name, value] of form.entries()) {
    // boundary + Content-Disposition / Content-Type overhead
    total += 80 + encoder.encode(name).byteLength;
    if (typeof value === 'string') {
      total += encoder.encode(value).byteLength;
    } else {
      total += value.size;
      if (value.name) total += encoder.encode(value.name).byteLength;
      if (value.type) total += encoder.encode(value.type).byteLength;
    }
  }
  total += 50; // closing boundary
  return total > 0 ? total : undefined;
}

function readContentLength(headers: Map<string, string>): number | undefined {
  const raw = getHeader(headers, 'content-length');
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function ensureContentLength(headers: Map<string, string>, length: number): void {
  if (!hasHeader(headers, 'content-length')) {
    setHeader(headers, 'content-length', String(length));
  }
}
