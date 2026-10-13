'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import type { PagedValue, UsePagedResourceOptions } from '../resource/types.js';
import { useStore } from './context.js';
import { useResource } from './use-resource.js';

/**
 * Cursor / offset pagination on top of one resource. `reload()` refetches every
 * page already loaded; `loadMore()` appends the next one.
 */
export function usePagedResource<TPage, TCursor = unknown>(
  options: UsePagedResourceOptions<TPage, TCursor>,
) {
  const store = useStore();
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<Error | null>(null);

  const load = useCallback(async (): Promise<PagedValue<TPage, TCursor>> => {
    const current = store.peek<PagedValue<TPage, TCursor>>(optionsRef.current.id);
    const cursors = current?.cursors.length ? current.cursors : [undefined];
    const pages: TPage[] = [];
    const usedCursors: Array<TCursor | undefined> = [];
    for (const cursor of cursors) {
      pages.push(await optionsRef.current.loadPage(cursor));
      usedCursors.push(cursor);
    }
    return { pages, cursors: usedCursors };
  }, [store]);

  const resource = useResource<PagedValue<TPage, TCursor>>({
    id: options.id,
    load,
    when: options.when,
    freshFor: options.freshFor,
    gcTime: options.gcTime,
    retries: options.retries,
    retryDelay: options.retryDelay,
    backoff: options.backoff,
    maxDelay: options.maxDelay,
    jitter: options.jitter,
  });

  const pages = useMemo(() => resource.value?.pages ?? [], [resource.value]);
  const nextCursor = useMemo(() => {
    const last = pages[pages.length - 1];
    if (last === undefined) return undefined;
    const cursor = optionsRef.current.nextCursor(last, pages);
    return cursor ? cursor : undefined;
  }, [pages]);
  const hasMore = nextCursor !== undefined;

  const loadMore = useCallback(async () => {
    const current = store.peek<PagedValue<TPage, TCursor>>(optionsRef.current.id);
    if (!current || loadingMore) return;
    const last = current.pages[current.pages.length - 1];
    if (last === undefined) return;
    const cursor = optionsRef.current.nextCursor(last, current.pages);
    if (!cursor) return;

    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const page = await optionsRef.current.loadPage(cursor);
      const latest = store.peek<PagedValue<TPage, TCursor>>(optionsRef.current.id) ?? current;
      store.push(optionsRef.current.id, {
        pages: [...latest.pages, page],
        cursors: [...latest.cursors, cursor],
      });
    } catch (err) {
      setLoadMoreError(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      setLoadingMore(false);
    }
  }, [store, loadingMore]);

  return {
    ...resource,
    pages,
    hasMore,
    loadMore,
    loadingMore,
    loadMoreError,
  };
}

export type UsePagedResourceResult<TPage, TCursor> = ReturnType<
  typeof usePagedResource<TPage, TCursor>
>;
