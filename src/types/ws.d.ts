declare module 'ws' {
  import type { EventEmitter } from 'node:events';

  class WebSocket extends EventEmitter {
    constructor(url: string, protocols?: string | string[], options?: { headers?: Record<string, string> });
    readonly readyState: number;
    send(data: string | ArrayBuffer | Blob): void;
    close(code?: number, reason?: string): void;
    addEventListener(type: string, listener: (...args: unknown[]) => void): void;
    removeEventListener(type: string, listener: (...args: unknown[]) => void): void;
  }

  export default WebSocket;
}
