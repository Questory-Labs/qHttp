import { bench, describe } from 'vitest';
import { buildRequestContext } from '../../src/core/build-request.js';
import { buildCacheKeyFromContext } from '../../src/core/build-request.js';
import { HookManager } from '../../src/interceptors/hook-manager.js';

describe('hot path benchmarks', () => {
  bench('buildRequestContext', () => {
    buildRequestContext({
      config: {
        baseUrl: 'https://api.example.com',
        url: '/users/{{id}}',
        urlMacros: { id: '123' },
        queryParams: { page: 1 },
      },
      method: 'GET',
    });
  });

  bench('buildCacheKeyFromContext', () => {
    const ctx = buildRequestContext({
      config: {
        baseUrl: 'https://api.example.com',
        url: '/users',
        queryParams: { page: 1 },
      },
      method: 'GET',
    });
    buildCacheKeyFromContext(ctx);
  });

  bench('HookManager.run empty phase', async () => {
    const manager = new HookManager();
    await manager.run('preRequest', { a: 1 });
  });
});
