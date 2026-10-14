import { describe, expect, it } from 'vitest';
import { QHttp } from '../../src/core/QHttp.js';
import { cursorParam, linkHeader, pageParam, parseNextLink } from '../../src/core/paginate.js';
import { MockAdapter } from '../../src/testing/mock-adapter.js';

type Page = { items: number[]; next?: string | null };

describe('paginate', () => {
  it('walks page numbers until hasMore is false', async () => {
    const adapter = new MockAdapter().get('/items', (_req, { url }) => {
      const page = Number(url.searchParams.get('page') ?? '1');
      return { body: { items: [page], next: page < 3 ? 'y' : null } };
    });
    const client = new QHttp({ adapter, baseUrl: 'https://api.test' });

    const pages = client.paginate<Page>({
      url: '/items',
      params: { page: 1 },
      next: pageParam({ hasMore: (r) => Boolean(r.data.next) }),
    });

    const items: number[] = [];
    for await (const item of pages.items((p) => p.items)) items.push(item);
    expect(items).toEqual([1, 2, 3]);
    expect(adapter.calls.map((c) => c.url)).toEqual([
      'https://api.test/items?page=1',
      'https://api.test/items?page=2',
      'https://api.test/items?page=3',
    ]);
  });

  it('follows cursors and respects maxPages', async () => {
    const adapter = new MockAdapter().get('/feed', (_req, { url }) => {
      const cursor = url.searchParams.get('cursor');
      return { body: { items: [cursor ?? 'start'], next: `${cursor ?? 'c'}1` } };
    });
    const client = new QHttp({ adapter, baseUrl: 'https://api.test' });
    const all = await client
      .paginate<Page>({
        url: '/feed',
        next: cursorParam({ getCursor: (r) => r.data.next }),
        maxPages: 3,
      })
      .all();
    expect(all.map((p) => p.items[0])).toEqual(['start', 'c1', 'c11']);
  });

  it('follows Link headers', async () => {
    const adapter = new MockAdapter()
      .get('/a', { body: { items: [1] }, headers: { link: '<https://api.test/b>; rel="next"' } })
      .get('/b', { body: { items: [2] } });
    const client = new QHttp({ adapter, baseUrl: 'https://api.test' });
    const all = await client.paginate<Page>({ url: '/a', next: linkHeader() }).all();
    expect(all.map((p) => p.items[0])).toEqual([1, 2]);
  });

  it('resolves relative Link headers against the current request', async () => {
    const adapter = new MockAdapter().get('/v1/items', (_req, { url }) => {
      const page = Number(url.searchParams.get('page') ?? '1');
      return {
        body: { items: [page] },
        headers: page < 2 ? { link: '<?page=2>; rel="next"' } : {},
      };
    });
    const client = new QHttp({ adapter, baseUrl: 'https://api.test' });
    const all = await client.paginate<Page>({ url: '/v1/items', next: linkHeader() }).all();
    expect(all.map((p) => p.items[0])).toEqual([1, 2]);
    expect(adapter.calls.map((c) => c.url)).toEqual([
      'https://api.test/v1/items',
      'https://api.test/v1/items?page=2',
    ]);
  });

  it('rejects cross-origin Link headers', async () => {
    const adapter = new MockAdapter().get('/a', {
      body: { items: [1] },
      headers: { link: '<//evil.test/b>; rel="next"' },
    });
    const client = new QHttp({ adapter, baseUrl: 'https://api.test' });
    await expect(client.paginate<Page>({ url: '/a', next: linkHeader() }).all()).rejects.toThrow(
      /cross-origin/,
    );
  });

  it('parses next links among several rels', () => {
    expect(
      parseNextLink('<https://x/prev>; rel="prev", <https://x/next>; rel=next, <https://x/l>; rel="last"'),
    ).toBe('https://x/next');
    expect(parseNextLink('<https://x/last>; rel="last"')).toBeUndefined();
  });
});
