import type {
  WSAdapter,
  WSAdapterConnectOptions,
  WSAdapterSocket,
} from './ws-adapter.interface.js';

export class BrowserWSAdapter implements WSAdapter {
  connect(options: WSAdapterConnectOptions): WSAdapterSocket {
    const socket = new WebSocket(options.url, options.protocols);
    return socket as unknown as WSAdapterSocket;
  }
}
