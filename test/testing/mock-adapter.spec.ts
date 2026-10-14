import { describe, expect, it } from 'vitest';
import { QHttp } from '../../src/core/QHttp.js';
import { MockAdapter, mockResponse } from '../../src/testing/mock-adapter.js';

describe('MockAdapter', () => {
  it('matches path params and reads JSON bodies', async () => {
    const adapter = new MockAdapter()
      .get('/users/:id', (_req, { params }) => ({ body: { id: params.id } }))
      .post('/users', async (_req, { body }) => ({ status: 201, body: await body() }));
    const client = new QHttp({ adapter, baseUrl: 'https://api.test' });

    const user = await client.get<{ id: string }>('/users/42');
    expect(user.data.id).toBe('42');

    const created = await client.post('/users', { body: { name: 'x' } });
    expect(created.httpStatus).toBe(201);
    expect(created.data).toEqual({ name: 'x' });
    expect(adapter.callsTo('POST', '/users')).toHaveLength(1);
  });

  it('supports once routes, regex routes and raw responses', async () => {
    const adapter = new MockAdapter()
      .once('GET', '/flaky', { status: 503 })
      .on('GET', /\/flaky$/, mockResponse({ ok: true }));
    const client = new QHttp({ adapter, baseUrl: 'https://api.test' }).setRetry({
      retries: 1,
      retryDelay: 1,
    });
    const result = await client.get('/flaky');
    expect(result.ok).toBe(true);
    expect(adapter.calls).toHaveLength(2);
  });

  it('throws a helpful error for unmatched requests', async () => {
    const adapter = new MockAdapter().get('/known', { body: {} });
    const client = new QHttp({ adapter, baseUrl: 'https://api.test' });
    await expect(client.get('/unknown')).rejects.toMatchObject({
      code: 'NETWORK',
      cause: expect.objectContaining({ message: expect.stringContaining('GET /known') }),
    });
  });

  it('can answer 404 for unmatched requests instead', async () => {
    const adapter = new MockAdapter({ unmatched: 'notFound' });
    const client = new QHttp({ adapter, baseUrl: 'https://api.test', throwOnError: false });
    const result = await client.get('/nothing');
    expect(result.httpStatus).toBe(404);
  });

  it('honours delay and abort', async () => {
    const adapter = new MockAdapter().get('/slow', { body: {}, delay: 50 });
    const client = new QHttp({ adapter, baseUrl: 'https://api.test' }).setTimeout(10);
    await expect(client.get('/slow')).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('mockResponse handles strings, bytes and empty bodies', async () => {
    expect((await mockResponse('hi').text())).toBe('hi');
    expect(mockResponse('hi').headers).toMatchObject({ 'content-type': 'text/plain;charset=UTF-8' });
    const bytes = mockResponse(new Uint8Array([1, 2]));
    expect(new Uint8Array(await bytes.arrayBuffer())).toEqual(new Uint8Array([1, 2]));
    const empty = mockResponse(undefined, { status: 204 });
    expect(empty.body).toBeNull();
    expect(empty.statusText).toBe('No Content');
  });
});
