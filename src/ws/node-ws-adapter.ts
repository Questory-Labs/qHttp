import type {
  WSAdapter,
  WSAdapterConnectOptions,
  WSAdapterSocket,
} from './ws-adapter.interface.js';

type WsConstructor = new (
  url: string,
  protocols?: string | string[],
  options?: { headers?: Record<string, string> },
) => WSAdapterSocket;

/**
 * Node WebSocket adapter backed by the optional `ws` peer dependency.
 *
 * Prefer `await NodeWSAdapter.create()` so the `ws` module is loaded before
 * `QWebSocket.setAdapter(...)` / `.connect()`.
 */
export class NodeWSAdapter implements WSAdapter {
  readonly #WS: WsConstructor;

  constructor(WS: WsConstructor) {
    this.#WS = WS;
  }

  static async create(): Promise<NodeWSAdapter> {
    const mod = await import('ws');
    return new NodeWSAdapter(mod.default as unknown as WsConstructor);
  }

  connect(options: WSAdapterConnectOptions): WSAdapterSocket {
    return new this.#WS(options.url, options.protocols, {
      headers: options.headers,
    });
  }
}

/** @deprecated Use `NodeWSAdapter.create()` then `adapter.connect(options)`. */
export async function createNodeWSSocket(
  options: WSAdapterConnectOptions,
): Promise<WSAdapterSocket> {
  const adapter = await NodeWSAdapter.create();
  return adapter.connect(options);
}
