export type WSReadyState = 'connecting' | 'open' | 'closing' | 'closed' | 'reconnecting';

export interface WSMessageEvent {
  data: string | ArrayBuffer | Blob;
}

export interface WSCloseEvent {
  code: number;
  reason: string;
  wasClean: boolean;
}

export interface WSAdapterConnectOptions {
  url: string;
  protocols?: string | string[];
  headers?: Record<string, string>;
}

export interface WSAdapterSocket {
  readonly readyState: number;
  send(data: string | ArrayBuffer | Blob): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'open' | 'message' | 'error' | 'close', listener: (event: unknown) => void): void;
  removeEventListener(type: 'open' | 'message' | 'error' | 'close', listener: (event: unknown) => void): void;
}

export interface WSAdapter {
  connect(options: WSAdapterConnectOptions): WSAdapterSocket;
}

export const WS_OPEN = 1;
export const WS_CONNECTING = 0;
export const WS_CLOSING = 2;
export const WS_CLOSED = 3;
