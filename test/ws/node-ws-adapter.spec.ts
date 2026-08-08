import { describe, expect, it, vi } from 'vitest';
import { NodeWSAdapter, createNodeWSSocket } from '../../src/ws/node-ws-adapter.js';

describe('NodeWSAdapter', () => {
  it('connects through an injected WebSocket constructor', () => {
    const constructed: unknown[] = [];
    class FakeWS {
      readyState = 0;
      constructor(
        public url: string,
        public protocols?: string | string[],
        public options?: { headers?: Record<string, string> },
      ) {
        constructed.push({ url, protocols, options });
      }
      send() {}
      close() {}
      addEventListener() {}
      removeEventListener() {}
    }

    const adapter = new NodeWSAdapter(FakeWS);
    const socket = adapter.connect({
      url: 'wss://example.com',
      protocols: 'proto',
      headers: { Authorization: 'Bearer x' },
    });

    expect(socket).toBeInstanceOf(FakeWS);
    expect(constructed).toEqual([
      {
        url: 'wss://example.com',
        protocols: 'proto',
        options: { headers: { Authorization: 'Bearer x' } },
      },
    ]);
  });

  it('createNodeWSSocket delegates to NodeWSAdapter.create', async () => {
    class FakeWS {
      readyState = 0;
      send() {}
      close() {}
      addEventListener() {}
      removeEventListener() {}
    }

    vi.doMock('ws', () => ({ default: FakeWS }));
    vi.resetModules();

    const { createNodeWSSocket: create } = await import('../../src/ws/node-ws-adapter.js');
    const socket = await create({ url: 'wss://example.com' });
    expect(socket).toBeInstanceOf(FakeWS);

    vi.doUnmock('ws');
    vi.resetModules();
  });
});
