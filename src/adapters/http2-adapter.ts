import { Buffer } from 'node:buffer';
import { QHttpError } from '../errors/qhttp-error.js';
import type { FinalRequest, HttpAdapter, RawResponseLike } from '../core/types.js';

interface Http2ClientRequest {
  end: (body?: Buffer | string) => void;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
}

interface Http2Session {
  request(headers: Record<string, string>): Http2ClientRequest;
  close: () => void;
  unref?: () => void;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  destroyed?: boolean;
  closed?: boolean;
}

interface Http2Module {
  connect: (
    authority: string,
    options?: { rejectUnauthorized?: boolean },
  ) => Http2Session;
}

export async function serializeHttp2Body(
  body: FinalRequest['body'],
): Promise<Buffer | string | undefined> {
  if (body == null) return undefined;
  if (typeof body === 'string') return body;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(body)) return body;
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  }
  if (body instanceof URLSearchParams) return body.toString();
  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    return Buffer.from(await body.arrayBuffer());
  }
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    throw new QHttpError('Http2Adapter does not support FormData bodies', {
      code: 'INVALID_CONFIG',
    });
  }
  if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) {
    throw new QHttpError('Http2Adapter does not support ReadableStream bodies', {
      code: 'INVALID_CONFIG',
    });
  }
  throw new QHttpError('Unsupported request body type for Http2Adapter', {
    code: 'INVALID_CONFIG',
  });
}

export class Http2Adapter implements HttpAdapter {
  readonly #sessions = new Map<string, Http2Session>();
  #http2Module: Http2Module | null = null;

  async send(request: FinalRequest): Promise<RawResponseLike> {
    const url = new URL(request.url);
    const origin = `${url.protocol}//${url.host}`;
    const session = await this.#getSession(origin);
    const bodyPayload = await serializeHttp2Body(request.body);

    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {
        ':method': request.method,
        ':path': `${url.pathname}${url.search}`,
        ':scheme': url.protocol.replace(':', ''),
        ':authority': url.host,
        ...request.headers,
      };

      const req = session.request(headers);
      const chunks: Buffer[] = [];
      let status = 0;
      const responseHeaders: Record<string, string> = {};

      req.on('response', ((responseHeadersRaw: Record<string, string | string[]>) => {
        status = Number(responseHeadersRaw[':status'] ?? 0);
        for (const [key, value] of Object.entries(responseHeadersRaw)) {
          if (key.startsWith(':')) continue;
          responseHeaders[key] = Array.isArray(value) ? value.join(', ') : value;
        }
      }) as (...args: unknown[]) => void);

      // Keep raw Buffers — never setEncoding('binary') (that yields latin1 strings).
      req.on('data', ((chunk: unknown) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
      }) as (...args: unknown[]) => void);

      req.on('end', () => {
        const bodyBuffer = Buffer.concat(chunks);
        const body = bodyBuffer.length
          ? new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new Uint8Array(bodyBuffer));
                controller.close();
              },
            })
          : null;

        resolve({
          ok: status >= 200 && status < 300,
          status,
          statusText: '',
          headers: responseHeaders,
          body,
          arrayBuffer: async () => {
            const copy = bodyBuffer.buffer.slice(
              bodyBuffer.byteOffset,
              bodyBuffer.byteOffset + bodyBuffer.byteLength,
            );
            return copy;
          },
          json: async () => JSON.parse(bodyBuffer.toString('utf-8')),
          text: async () => bodyBuffer.toString('utf-8'),
          blob: async () => new Blob([bodyBuffer]),
        });
      });

      req.on('error', ((error: unknown) => {
        reject(error instanceof Error ? error : new Error(String(error)));
      }) as (...args: unknown[]) => void);

      if (bodyPayload !== undefined) {
        req.end(bodyPayload);
      } else {
        req.end();
      }
    });
  }

  async #getSession(origin: string): Promise<Http2Session> {
    const existing = this.#sessions.get(origin);
    if (existing && !existing.destroyed && !existing.closed) {
      return existing;
    }
    if (existing) {
      this.#sessions.delete(origin);
    }

    if (!this.#http2Module) {
      const mod = (await import('node:http2')) as Http2Module;
      this.#http2Module = mod;
    }

    const session = this.#http2Module.connect(origin);
    session.unref?.();

    const evict = () => {
      if (this.#sessions.get(origin) === session) {
        this.#sessions.delete(origin);
      }
    };
    session.on('close', evict);
    session.on('error', evict);
    session.on('goaway', evict);

    this.#sessions.set(origin, session);
    return session;
  }

  close(): void {
    for (const session of this.#sessions.values()) {
      session.close();
    }
    this.#sessions.clear();
  }
}
