import { describe, expect, it, vi } from 'vitest';
import { FetchAdapter } from '../../src/adapters/fetch-adapter.js';

describe('FetchAdapter', () => {
  it('calls global fetch with request config', async () => {
    const response = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new FetchAdapter();
    const raw = await adapter.send({
      url: 'https://api.example.com/x',
      method: 'GET',
      headers: { accept: 'application/json' },
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(raw.status).toBe(200);
    expect(await raw.json()).toEqual({ ok: true });
  });
});
