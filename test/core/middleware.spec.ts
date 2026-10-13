import { describe, expect, it, vi } from 'vitest';
import { QHttp } from '../../src/core/QHttp.js';
import { compose } from '../../src/core/pipeline.js';
import type { Middleware, RequestContext } from '../../src/core/types.js';
import { QHttpError } from '../../src/errors/qhttp-error.js';
import { SpyAdapter, deferred, mockResponse } from '../helpers.js';

describe('compose', () => {
  it('runs middleware in order and lets next() swap the context', async () => {
    const order: string[] = [];
    const a: Middleware = async (ctx, next) => {
      order.push('a');
      const r = await next({ ...ctx, meta: { swapped: true } });
      order.push('a-after');
      return r;
    };
    const b: Middleware = async (ctx, next) => {
      order.push(`b:${String(ctx.meta.swapped)}`);
      return next();
    };
    const chain = compose([a, b]);
    const result = await chain({ meta: {} } as RequestContext, async (ctx) => {
      order.push(`terminal:${String(ctx?.meta.swapped)}`);
      return { data: 1 } as never;
    });
    expect(order).toEqual(['a', 'b:true', 'terminal:true', 'a-after']);
    expect(result).toEqual({ data: 1 });
  });
});

describe('user middleware', () => {
  it('runs outermost and can short-circuit', async () => {
    const adapter = new SpyAdapter();
    const client = new QHttp({ adapter }).use(async (ctx, next) => {
      if (ctx.meta.stub) {
        return {
          data: 'stubbed',
          httpStatus: 200,
          statusText: 'OK',
          headers: {},
          ok: true,
          request: { url: ctx.resolvedUrl, method: ctx.method, headers: {} },
          fetchStatus: 'success',
          fromCache: false,
          requestId: ctx.requestId,
          timing: { startedAt: 0, endedAt: 0, durationMs: 0, attempts: 0 },
        };
      }
      const result = await next();
      result.headers['x-seen'] = '1';
      return result;
    });

    const stubbed = await client.get('https://api.example.com/x', { meta: { stub: true } });
    expect(stubbed.data).toBe('stubbed');
    expect(adapter.send).not.toHaveBeenCalled();

    const real = await client.get('https://api.example.com/x');
    expect(real.headers['x-seen']).toBe('1');
    expect(adapter.send).toHaveBeenCalledOnce();
  });

  it('clone carries middleware along', async () => {
    const adapter = new SpyAdapter();
    const seen: string[] = [];
    const client = new QHttp({ adapter }).use(async (ctx, next) => {
      seen.push(ctx.resolvedUrl);
      return next();
    });
    await client.clone().get('https://api.example.com/cloned');
    expect(seen).toEqual(['https://api.example.com/cloned']);
  });
});

describe('dedupe', () => {
  it('shares one in-flight response between identical GETs', async () => {
    const adapter = new SpyAdapter();
    const gate = deferred<void>();
    adapter.send.mockImplementation(async () => {
      await gate.promise;
      return mockResponse({ n: 1 });
    });
    const client = new QHttp({ adapter }).dedupe();

    const p1 = client.get('https://api.example.com/x');
    const p2 = client.get('https://api.example.com/x');
    const p3 = client.get('https://api.example.com/y');
    gate.resolve();
    const [a, b] = await Promise.all([p1, p2, p3]);

    expect(adapter.send).toHaveBeenCalledTimes(2);
    expect(a.data).toEqual(b.data);
    // After settling, a new call hits the network again.
    await client.get('https://api.example.com/x');
    expect(adapter.send).toHaveBeenCalledTimes(3);
  });

  it('never dedupes unsafe methods', async () => {
    const adapter = new SpyAdapter();
    const client = new QHttp({ adapter }).dedupe();
    await Promise.all([
      client.post('https://api.example.com/x', { body: { a: 1 } }),
      client.post('https://api.example.com/x', { body: { a: 1 } }),
    ]);
    expect(adapter.send).toHaveBeenCalledTimes(2);
  });
});

describe('auth refresh', () => {
  it('refreshes once on 401 and replays with the new token', async () => {
    const adapter = new SpyAdapter();
    adapter.send.mockImplementation(async (request) => {
      const auth = (request as { headers: Record<string, string> }).headers.authorization;
      return auth === 'Bearer new'
        ? mockResponse({ ok: true })
        : mockResponse({ error: 'expired' }, { status: 401 });
    });
    const refresh = vi.fn(async () => 'new');
    const client = new QHttp({ adapter }).setAuth({
      type: 'bearer',
      token: 'old',
      refresh: { run: refresh },
    });

    const [a, b] = await Promise.all([
      client.get('https://api.example.com/a'),
      client.get('https://api.example.com/b'),
    ]);
    expect(a.ok && b.ok).toBe(true);
    expect(refresh).toHaveBeenCalledOnce();
    expect(client.config.auth).toMatchObject({ token: 'new' });

    await client.get('https://api.example.com/c');
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('gives up after one refresh attempt', async () => {
    const adapter = new SpyAdapter();
    adapter.send.mockResolvedValue(mockResponse({}, { status: 401 }));
    const client = new QHttp({ adapter }).setAuth({
      type: 'bearer',
      token: () => 'always-bad',
      refresh: { run: async () => undefined },
    });
    await expect(client.get('https://api.example.com/a')).rejects.toMatchObject({
      httpStatus: 401,
    });
    expect(adapter.send).toHaveBeenCalledTimes(2);
  });

  it('auth:false disables auth per call', async () => {
    const adapter = new SpyAdapter();
    const client = new QHttp({ adapter }).setAuth({ type: 'bearer', token: 't' });
    await client.get('https://api.example.com/public', { auth: false });
    expect(adapter.send.mock.calls[0]![0].headers.authorization).toBeUndefined();
  });
});

describe('parse', () => {
  const schema = {
    '~standard': {
      version: 1 as const,
      vendor: 'test',
      validate: (value: unknown) =>
        typeof value === 'object' && value && 'id' in value
          ? { value: value as { id: number } }
          : { issues: [{ message: 'id required', path: ['id'] }] },
    },
  };

  it('validates with a Standard Schema and typed data', async () => {
    const adapter = new SpyAdapter();
    adapter.send.mockResolvedValue(mockResponse({ id: 1 }));
    const client = new QHttp({ adapter });
    const result = await client.get('https://api.example.com/x', { parse: schema });
    expect(result.data.id).toBe(1);
  });

  it('throws VALIDATION_ERROR with issues', async () => {
    const adapter = new SpyAdapter();
    adapter.send.mockResolvedValue(mockResponse({ nope: true }));
    const client = new QHttp({ adapter }).parse(schema);
    const err = await client.get('https://api.example.com/x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(QHttpError);
    expect((err as QHttpError).code).toBe('VALIDATION_ERROR');
    expect((err as QHttpError).issues?.[0]?.message).toBe('id required');
  });

  it('accepts plain transform functions', async () => {
    const adapter = new SpyAdapter();
    adapter.send.mockResolvedValue(mockResponse({ n: 2 }));
    const client = new QHttp({ adapter });
    const result = await client.get('https://api.example.com/x', {
      parse: (d) => (d as { n: number }).n * 2,
    });
    expect(result.data).toBe(4);
  });
});

describe('cache key isolation', () => {
  it('keys authenticated requests per credential', async () => {
    const adapter = new SpyAdapter();
    adapter.send.mockImplementation(async (request) =>
      mockResponse({ who: (request as { headers: Record<string, string> }).headers.authorization }),
    );
    const client = new QHttp({ adapter }).cache();

    const a = await client.get('https://api.example.com/me', {
      auth: { type: 'bearer', token: 'alice' },
    });
    const b = await client.get('https://api.example.com/me', {
      auth: { type: 'bearer', token: 'bob' },
    });
    const a2 = await client.get('https://api.example.com/me', {
      auth: { type: 'bearer', token: 'alice' },
    });

    expect(a.data).toEqual({ who: 'Bearer alice' });
    expect(b.data).toEqual({ who: 'Bearer bob' });
    expect(a2.fromCache).toBe(true);
    expect(adapter.send).toHaveBeenCalledTimes(2);
  });

  it('cache engine failures never fail the request', async () => {
    const adapter = new SpyAdapter();
    const broken = {
      get: vi.fn().mockRejectedValue(new Error('redis down')),
      set: vi.fn().mockRejectedValue(new Error('redis down')),
      delete: vi.fn(),
      clear: vi.fn(),
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = new QHttp({ adapter }).cache().cacheEngine(broken);
    const result = await client.get('https://api.example.com/x');
    expect(result.ok).toBe(true);
    expect(broken.get).toHaveBeenCalled();
    expect(broken.set).toHaveBeenCalled();
    warn.mockRestore();
  });
});
