import { describe, expect, it } from 'vitest';
import { applyAuth, toBase64 } from '../../src/auth/auth.js';
import { mergeHeaders } from '../../src/utils/headers.js';
import type { RequestContext } from '../../src/core/types.js';

function baseContext(): RequestContext {
  return {
    url: '/',
    resolvedUrl: 'https://api.example.com/',
    method: 'GET',
    headers: mergeHeaders(undefined, {}),
    queryParams: {},
    responseType: 'auto',
    macros: {},
  };
}

describe('auth', () => {
  it('encodes basic auth', () => {
    expect(toBase64('user:pass')).toBeTruthy();
  });

  it('applies bearer token', () => {
    const ctx = applyAuth(baseContext(), { type: 'bearer', token: 'abc' });
    expect(ctx.headers.get('authorization')).toBe('Bearer abc');
  });

  it('applies basic auth', () => {
    const ctx = applyAuth(baseContext(), {
      type: 'basic',
      username: 'user',
      password: 'pass',
    });
    expect(ctx.headers.get('authorization')).toMatch(/^Basic /);
  });
});
