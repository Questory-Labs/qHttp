import { warnDev } from '../utils/env.js';
import type { WSAdapter, WSAdapterConnectOptions, WSAdapterSocket } from './ws-adapter.interface.js';

export class BrowserWSAdapter implements WSAdapter {
  connect(options: WSAdapterConnectOptions): WSAdapterSocket {
    if (options.headers && Object.keys(options.headers).length > 0) {
      warnDev(
        'Browser WebSockets cannot send custom headers; they were ignored. Use a query string, a subprotocol or NodeWSAdapter.',
      );
    }
    const socket = new WebSocket(options.url, options.protocols);
    return socket as unknown as WSAdapterSocket;
  }
}
