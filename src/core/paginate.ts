import { isAbsoluteUrl } from '../utils/url.js';
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
      // A new URL is a complete next-page address; don't carry the old query forward.
      const params = following.url
        ? following.params
        : { ...current.params, ...following.params };
      current = { ...current, ...following, params };
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

/**
 * RFC 8288 `Link: <url>; rel="next"` pagination. Absolute links to another
 * origin are rejected unless `allowCrossOrigin` is set, so configured
 * credentials are never sent to a host the caller did not choose.
 */
export function linkHeader<T>(options: { allowCrossOrigin?: boolean } = {}): NextPage<T> {
  return (result) => {
    const link = result.headers.link ?? result.headers.Link;
    if (!link) return null;
    const target = parseNextLink(link);
    if (!target) return null;
    // Resolve against the current request so `?page=2` keeps its path.
    const resolved = resolveUrl(target, result.request.url);
    const url = resolved ?? target;
    if (
      !options.allowCrossOrigin &&
      (resolved !== undefined || isAbsoluteUrl(target)) &&
      !isSameOrigin(url, result.request.url)
    ) {
      throw new Error(`linkHeader: refusing cross-origin next link ${url}`);
    }
    return { url, params: {} };
  };
}

function requestBase(requestUrl: string): URL {
  const location = (globalThis as { location?: { href?: string } }).location?.href;
  return new URL(requestUrl, location);
}

function resolveUrl(link: string, requestUrl: string): string | undefined {
  try {
    return new URL(link, requestBase(requestUrl)).href;
  } catch {
    return undefined;
  }
}

function isSameOrigin(link: string, requestUrl: string): boolean {
  try {
    const request = requestBase(requestUrl);
    return new URL(link, request).origin === request.origin;
  } catch {
    return false;
  }
}

export function parseNextLink(header: string): string | undefined {
  for (const part of splitOutside(header, ',')) {
    const match = /^<([^>]*)>(.*)$/s.exec(part.trim());
    if (!match) continue;
    for (const param of splitOutside(match[2] ?? '', ';')) {
      const eq = param.indexOf('=');
      if (eq === -1 || param.slice(0, eq).trim().toLowerCase() !== 'rel') continue;
      const value = param.slice(eq + 1).trim().replace(/^"(.*)"$/s, '$1');
      if (value.toLowerCase().split(/\s+/).includes('next')) return match[1];
    }
  }
  return undefined;
}

/** Split on `separator` outside `<...>` and quoted strings. */
function splitOutside(input: string, separator: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let inAngle = false;
  let inQuote = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuote) {
      if (ch === '\\') i++;
      else if (ch === '"') inQuote = false;
    } else if (inAngle) {
      if (ch === '>') inAngle = false;
    } else if (ch === '"') {
      inQuote = true;
    } else if (ch === '<') {
      inAngle = true;
    } else if (ch === separator) {
      parts.push(input.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(input.slice(start));
  return parts;
}
