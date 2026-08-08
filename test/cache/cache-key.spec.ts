import { describe, expect, it } from 'vitest';
import { buildCacheKeyFromContext } from '../../src/core/build-request.js';
import { buildRequestContext } from '../../src/core/build-request.js';

describe('cache key', () => {
  it('matches query serialization used in build-request', () => {
    const ctx = buildRequestContext({
      config: {
        baseUrl: 'https://api.example.com',
        url: '/items',
        queryParams: { page: 1, tag: ['a', 'b'] },
      },
      method: 'GET',
    });

    const key = buildCacheKeyFromContext(ctx);
    expect(key).toContain('GET:https://api.example.com/items');
    expect(key).toContain('page=1');
    expect(key).toContain('tag=a');
    expect(key).toContain('tag=b');
  });
});
