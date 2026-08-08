import { describe, expect, it } from 'vitest';
import { QHttp } from '../../src/core/QHttp.js';
import { joinUrl } from '../../src/utils/url.js';
import { resolveMacros } from '../../src/utils/url-macros.js';
import { serializeParams } from '../../src/utils/query.js';
import { QHttpError } from '../../src/errors/qhttp-error.js';

describe('QHttp builder', () => {
  it('chains setters and returns this', () => {
    const client = new QHttp()
      .setBaseUrl('https://api.example.com')
      .setUrl('/users')
      .setQueryParams({ page: 1 })
      .setHeaders({ 'X-App': 'demo' });

    expect(client).toBeInstanceOf(QHttp);
  });

  it('clone isolates config', () => {
    const base = new QHttp().setBaseUrl('https://api.example.com').setUrl('/a');
    const copy = base.clone().setUrl('/b');
    expect(joinUrl('https://api.example.com', '/a')).toBe('https://api.example.com/a');
    expect(joinUrl('https://api.example.com', '/b')).toBe('https://api.example.com/b');
    expect(copy).not.toBe(base);
  });
});

describe('url utils', () => {
  it('joins base and path with single slash', () => {
    expect(joinUrl('https://api.example.com/', '/users')).toBe('https://api.example.com/users');
    expect(joinUrl('https://api.example.com', 'users')).toBe('https://api.example.com/users');
  });

  it('resolves macros with encoding', () => {
    expect(resolveMacros('/users/{{userId}}', { userId: 'a/b' })).toBe('/users/a%2Fb');
  });

  it('throws on unresolved macros in strict mode', () => {
    expect(() => resolveMacros('/users/{{id}}', {}, { strict: true })).toThrow(QHttpError);
  });
});

describe('query serialization', () => {
  it('serializes arrays by repeating keys', () => {
    expect(serializeParams({ tag: ['a', 'b'] })).toBe('tag=a&tag=b');
  });

  it('skips null and undefined', () => {
    expect(serializeParams({ a: null, b: undefined, c: 'x' })).toBe('c=x');
  });

  it('serializes dates as ISO', () => {
    const date = new Date('2024-01-01T00:00:00.000Z');
    expect(serializeParams({ since: date })).toBe('since=2024-01-01T00%3A00%3A00.000Z');
  });

  it('throws on nested objects', () => {
    expect(() => serializeParams({ filter: { a: 1 } })).toThrow(QHttpError);
  });
});
