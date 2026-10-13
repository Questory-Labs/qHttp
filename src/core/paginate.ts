import type { QHttpResult, RequestOptions } from './types.js';

export type NextPage<T> = (
  result: QHttpResult<T>,
  page: number,
) => RequestOptions<T> | null | undefined | false;

export interface PaginateOptions<T> extends RequestOptions<T> {
  /** Options for the next page, or a falsy value to stop. */
  next: NextPage<T>;
  /** Safety cap. Default 1000. */
  maxPages?: number;
}

export interface Paginator<T> extends AsyncIterable<QHttpResult<T>> {
  /** Flatten pages into items via `select`. */
  items<I>(select: (page: T) => readonly I[]): AsyncIterable<I>;
  /** Collect every page's data. */
  all(): Promise<T[]>;
}

export function createPaginator<T>(
  request: (options: RequestOptions<T>) => Promise<QHttpResult<T>>,
  options: PaginateOptions<T>,
): Paginator<T> {
  const { next, maxPages = 1000, ...first } = options;

  async function* pages(): AsyncGenerator<QHttpResult<T>> {
    let current: RequestOptions<T> = first;
    for (let page = 1; page <= maxPages; page++) {
      const result = await request(current);
      yield result;
      const following = next(result, page);
      if (!following) return;
      current = { ...current, ...following, params: { ...current.params, ...following.params } };
    }
  }

  return {
    [Symbol.asyncIterator]: pages,
    async *items<I>(select: (page: T) => readonly I[]) {
      for await (const page of pages()) {
        yield* select(page.data);
      }
    },
    async all() {
      const out: T[] = [];
      for await (const page of pages()) out.push(page.data);
      return out;
    },
  };
}

/** `?page=N` pagination. Stops when `hasMore` returns false. */
export function pageParam<T>(options: {
  param?: string;
  start?: number;
  hasMore: (result: QHttpResult<T>, page: number) => boolean;
}): NextPage<T> {
  const param = options.param ?? 'page';
  const start = options.start ?? 1;
  return (result, page) =>
    options.hasMore(result, page) ? { params: { [param]: start + page } } : null;
}

/** Cursor pagination. Stops when `getCursor` returns a falsy value. */
export function cursorParam<T>(options: {
  param?: string;
  getCursor: (result: QHttpResult<T>) => string | number | null | undefined;
}): NextPage<T> {
  const param = options.param ?? 'cursor';
  return (result) => {
    const cursor = options.getCursor(result);
    return cursor ? { params: { [param]: cursor } } : null;
  };
}

/** RFC 8288 `Link: <url>; rel="next"` pagination. */
export function linkHeader<T>(): NextPage<T> {
  return (result) => {
    const link = result.headers.link ?? result.headers.Link;
    if (!link) return null;
    const url = parseNextLink(link);
    return url ? { url, params: {} } : null;
  };
}

export function parseNextLink(header: string): string | undefined {
  for (const part of header.split(',')) {
    const match = /<([^>]+)>\s*;(.*)/.exec(part.trim());
    if (!match) continue;
    if (/rel\s*=\s*"?next"?/i.test(match[2] ?? '')) return match[1];
  }
  return undefined;
}
