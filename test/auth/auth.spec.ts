import { describe, expect, it, vi } from 'vitest';
import { applyAuth, resolveToken, toBase64 } from '../../src/auth/auth.js';
import { mergeHeaders } from '../../src/utils/headers.js';
import type { RequestContext } from '../../src/core/types.js';

function baseContext(): RequestContext {
  return {
    requestId: 'r1',
    startedAt: Date.now(),
    url: '/',
    resolvedUrl: 'https://api.example.com/',
    method: 'GET',
    headers: mergeHeaders(undefined, {}),
    queryParams: {},
    responseType: 'auto',
    macros: {},
    meta: {},
    state: { attempt: 0 },
  };
}

describe('auth', () => {
  it('encodes basic auth', () => {
    expect(toBase64('user:pass')).toBeTruthy();
  });

  it('applies bearer token', async () => {
    const ctx = await applyAuth(baseContext(), { type: 'bearer', token: 'abc' });
    expect(ctx.headers.get('authorization')).toBe('Bearer abc');
  });

  it('resolves bearer token providers', async () => {
    const provider = vi.fn(async () => 'fresh');
    const ctx = await applyAuth(baseContext(), { type: 'bearer', token: provider });
    expect(ctx.headers.get('authorization')).toBe('Bearer fresh');
    expect(provider).toHaveBeenCalledOnce();
    expect(await resolveToken('static')).toBe('static');
  });

  it('applies basic auth', async () => {
    const ctx = await applyAuth(baseContext(), {
      type: 'basic',
      username: 'user',
      password: 'pass',
    });
    expect(ctx.headers.get('authorization')).toMatch(/^Basic /);
  });

  it('applies custom auth', async () => {
    const ctx = await applyAuth(baseContext(), {
      type: 'custom',
      apply: (c) => {
        c.headers.set('x-api-key', 'k');
      },
    });
    expect(ctx.headers.get('x-api-key')).toBe('k');
  });
});
