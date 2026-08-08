import type { FinalRequest, HttpAdapter, RawResponseLike } from '../core/types.js';

export class FetchAdapter implements HttpAdapter {
  async send(request: FinalRequest): Promise<RawResponseLike> {
    const init: RequestInit & { duplex?: 'half' } = {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: request.signal,
    };

    if (request.duplex) {
      init.duplex = request.duplex;
    }

    const response = await fetch(request.url, init);
    return wrapFetchResponse(response);
  }
}

function wrapFetchResponse(response: Response): RawResponseLike {
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
  };
}

export const defaultFetchAdapter = new FetchAdapter();
