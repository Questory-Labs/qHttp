import type { FetchOptions, FinalRequest, HttpAdapter, RawResponseLike } from '../core/types.js';

export interface FetchAdapterOptions {
  /** Defaults merged under every request's `init` (e.g. `{ credentials: 'include' }`). */
  defaults?: FetchOptions;
  /** Custom fetch implementation (undici, a polyfill, or a test double). */
  fetch?: typeof fetch;
}

export class FetchAdapter implements HttpAdapter {
  readonly #defaults?: FetchOptions;
  readonly #fetch?: typeof fetch;

  constructor(options: FetchAdapterOptions = {}) {
    this.#defaults = options.defaults;
    this.#fetch = options.fetch;
  }

  async send(request: FinalRequest): Promise<RawResponseLike> {
    const init: RequestInit & { duplex?: 'half' } = {
      ...this.#defaults,
      ...request.init,
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: request.signal,
    };

    if (request.duplex) {
      init.duplex = request.duplex;
    }

    const doFetch = this.#fetch ?? globalThis.fetch;
    const response = await doFetch(request.url, init);
    return wrapFetchResponse(response);
  }
}

export function wrapFetchResponse(response: Response): RawResponseLike {
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
    body: response.body,
    arrayBuffer: () => response.arrayBuffer(),
    json: () => response.json(),
    text: () => response.text(),
    blob: () => response.blob(),
    raw: response,
  };
}

export const defaultFetchAdapter = new FetchAdapter();
