import { describe, expect, it } from 'vitest';
import { buildRequestContext, sortBodyKeys } from '../../src/core/build-request.js';
import { QHttpError } from '../../src/errors/qhttp-error.js';

describe('build-request', () => {
  it('throws on unresolved macros', () => {
    expect(() =>
      buildRequestContext({
        config: { baseUrl: 'https://api.example.com', url: '/users/{{id}}' },
        method: 'GET',
      }),
    ).toThrow(QHttpError);
  });

  it('sorts body keys deterministically', () => {
    expect(sortBodyKeys({ b: 1, a: 2 })).toEqual({ a: 2, b: 1 });
  });
});
