import type { FinalRequest, HttpAdapter, HttpMethod, RawResponseLike } from '../core/types.js';

export interface MockResponseInit {
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  /** Simulated latency in ms. */
  delay?: number;
}

/** Build a `RawResponseLike`. Objects become JSON; strings and bytes pass through. */
export function mockResponse(body?: unknown, init: MockResponseInit = {}): RawResponseLike {
  const status = init.status ?? 200;
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(init.headers ?? {})) headers[k.toLowerCase()] = v;

  let bytes: Uint8Array<ArrayBuffer>;
  if (body === undefined || body === null) {
    bytes = new Uint8Array(0);
  } else if (typeof body === 'string') {
    bytes = copyBytes(new TextEncoder().encode(body));
    headers['content-type'] ??= 'text/plain;charset=UTF-8';
  } else if (body instanceof ArrayBuffer) {
    bytes = new Uint8Array(body);
    headers['content-type'] ??= 'application/octet-stream';
  } else if (ArrayBuffer.isView(body)) {
    bytes = copyBytes(new Uint8Array(body.buffer, body.byteOffset, body.byteLength));
    headers['content-type'] ??= 'application/octet-stream';
  } else {
    bytes = copyBytes(new TextEncoder().encode(JSON.stringify(body)));
    headers['content-type'] ??= 'application/json';
  }
  headers['content-length'] ??= String(bytes.byteLength);

  const text = () => new TextDecoder().decode(bytes);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: init.statusText ?? defaultStatusText(status),
    headers,
    body:
      bytes.byteLength > 0
        ? new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(bytes);
              controller.close();
            },
          })
        : null,
    arrayBuffer: async () => bytes.buffer.slice(0),
    json: async () => JSON.parse(text()),
    text: async () => text(),
    blob: async () => new Blob([bytes], { type: headers['content-type'] }),
  };
}

function copyBytes(view: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(view.byteLength));
  out.set(view);
  return out;
}

function defaultStatusText(status: number): string {
  const map: Record<number, string> = {
    200: 'OK',
    201: 'Created',
    204: 'No Content',
    304: 'Not Modified',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    409: 'Conflict',
    422: 'Unprocessable Entity',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
    504: 'Gateway Timeout',
  };
  return map[status] ?? '';
}

export interface MockMatch {
  /** Named `:param` segments from the route pattern. */
  params: Record<string, string>;
  url: URL;
  /** Request body decoded as JSON when possible, else as text. */
  body: () => Promise<unknown>;
}

export type MockReply =
  | RawResponseLike
  | (MockResponseInit & { body?: unknown })
  | ((request: FinalRequest, match: MockMatch) => MockReply | Promise<MockReply>);

interface Route {
  method: HttpMethod | '*';
  matcher: (request: FinalRequest) => Record<string, string> | undefined;
  reply: MockReply;
  once: boolean;
  description: string;
}

export interface MockAdapterOptions {
  /** What to do when nothing matches. Default `'throw'`. */
  unmatched?: 'throw' | 'notFound';
}

/**
 * In-memory HTTP adapter for tests.
 *
 * ```ts
 * const api = new MockAdapter()
 *   .get('/users/:id', (req, { params }) => ({ body: { id: params.id } }))
 *   .post('/users', { status: 201, body: { ok: true } });
 * const client = new QHttp({ adapter: api, baseUrl: 'https://api.test' });
 * ```
 */
export class MockAdapter implements HttpAdapter {
  readonly calls: FinalRequest[] = [];
  readonly #routes: Route[] = [];
  readonly #options: MockAdapterOptions;

  constructor(options: MockAdapterOptions = {}) {
    this.#options = options;
  }

  on(method: HttpMethod | '*', path: string | RegExp, reply: MockReply): this {
    this.#routes.push({
      method,
      matcher: compileMatcher(path),
      reply,
      once: false,
      description: `${method} ${String(path)}`,
    });
    return this;
  }

  /** Like `on`, but the route is removed after its first match. */
  once(method: HttpMethod | '*', path: string | RegExp, reply: MockReply): this {
    this.#routes.push({
      method,
      matcher: compileMatcher(path),
      reply,
      once: true,
      description: `${method} ${String(path)} (once)`,
    });
    return this;
  }

  get(path: string | RegExp, reply: MockReply): this {
    return this.on('GET', path, reply);
  }

  post(path: string | RegExp, reply: MockReply): this {
    return this.on('POST', path, reply);
  }

  put(path: string | RegExp, reply: MockReply): this {
    return this.on('PUT', path, reply);
  }

  patch(path: string | RegExp, reply: MockReply): this {
    return this.on('PATCH', path, reply);
  }

  delete(path: string | RegExp, reply: MockReply): this {
    return this.on('DELETE', path, reply);
  }

  /** Clear routes and recorded calls. */
  reset(): this {
    this.#routes.length = 0;
    this.calls.length = 0;
    return this;
  }

  /** Recorded requests matching a method and path pattern. */
  callsTo(method: HttpMethod | '*', path: string | RegExp): FinalRequest[] {
    const matcher = compileMatcher(path);
    return this.calls.filter(
      (call) => (method === '*' || call.method === method) && matcher(call) !== undefined,
    );
  }

  async send(request: FinalRequest): Promise<RawResponseLike> {
    this.calls.push(request);
    if (request.signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    for (let i = 0; i < this.#routes.length; i++) {
      const route = this.#routes[i]!;
      if (route.method !== '*' && route.method !== request.method) continue;
      const params = route.matcher(request);
      if (!params) continue;
      if (route.once) this.#routes.splice(i, 1);

      const match: MockMatch = {
        params,
        url: new URL(request.url),
        body: () => readBody(request.body),
      };
      const reply = await resolveReply(route.reply, request, match);
      const raw = toRaw(reply);
      const delay = isInit(reply) ? reply.delay : undefined;
      if (delay) await sleepWithSignal(delay, request.signal);
      if (request.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      return raw;
    }

    if (this.#options.unmatched === 'notFound') {
      return mockResponse({ error: 'No mock route' }, { status: 404 });
    }
    const known = this.#routes.map((r) => `  ${r.description}`).join('\n') || '  (none)';
    throw new Error(
      `MockAdapter: no route for ${request.method} ${request.url}\nRegistered routes:\n${known}`,
    );
  }
}

function isRaw(value: unknown): value is RawResponseLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as RawResponseLike).arrayBuffer === 'function' &&
    typeof (value as RawResponseLike).status === 'number'
  );
}

function isInit(value: unknown): value is MockResponseInit & { body?: unknown } {
  return typeof value === 'object' && value !== null && !isRaw(value);
}

async function resolveReply(
  reply: MockReply,
  request: FinalRequest,
  match: MockMatch,
): Promise<Exclude<MockReply, (...args: never[]) => unknown>> {
  let current: MockReply = reply;
  while (typeof current === 'function') {
    current = await current(request, match);
  }
  return current;
}

function toRaw(reply: Exclude<MockReply, (...args: never[]) => unknown>): RawResponseLike {
  if (isRaw(reply)) return reply;
  const { body, ...init } = reply;
  return mockResponse(body, init);
}

function compileMatcher(path: string | RegExp): (request: FinalRequest) => Record<string, string> | undefined {
  if (path instanceof RegExp) {
    return (request) => {
      const url = new URL(request.url);
      const target = `${url.pathname}${url.search}`;
      const m = path.exec(target) ?? path.exec(request.url);
      return m ? { ...m.groups } : undefined;
    };
  }

  const absolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(path);
  const [pathPart] = path.split('?');
  const names: string[] = [];
  const source = (pathPart ?? '')
    .split('/')
    .map((segment) => {
      if (segment.startsWith(':')) {
        names.push(segment.slice(1));
        return '([^/]+)';
      }
      if (segment === '*') return '.*';
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  const regex = new RegExp(`^${source}/?$`);

  return (request) => {
    const url = new URL(request.url);
    const target = absolute ? `${url.origin}${url.pathname}` : url.pathname;
    const m = regex.exec(target);
    if (!m) return undefined;
    const params: Record<string, string> = {};
    names.forEach((name, i) => {
      params[name] = decodeURIComponent(m[i + 1] ?? '');
    });
    return params;
  };
}

async function readBody(body: FinalRequest['body']): Promise<unknown> {
  if (body == null) return undefined;
  let text: string;
  if (typeof body === 'string') text = body;
  else if (body instanceof URLSearchParams) return Object.fromEntries(body.entries());
  else if (typeof FormData !== 'undefined' && body instanceof FormData) {
    return Object.fromEntries(body.entries());
  } else if (body instanceof ArrayBuffer) text = new TextDecoder().decode(body);
  else if (ArrayBuffer.isView(body)) {
    text = new TextDecoder().decode(new Uint8Array(body.buffer, body.byteOffset, body.byteLength));
  } else if (typeof Blob !== 'undefined' && body instanceof Blob) text = await body.text();
  else if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) {
    text = await new Response(body).text();
  } else return body;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function sleepWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
