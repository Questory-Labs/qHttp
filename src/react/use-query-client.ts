'use client';

import { useMemo } from 'react';
import { useQueryCache } from './context.js';
import type { InvalidateFilter, QueryKey } from '../query/types.js';

export type QueryClient = {
  invalidate: (filter: InvalidateFilter) => void;
  invalidateQueries: (filter: { queryKey: QueryKey; exact?: boolean }) => void;
  setQueryData: <T>(key: QueryKey, data: T) => void;
  getQueryData: <T>(key: QueryKey) => T | undefined;
  fetchQuery: typeof import('../query/query-cache.js').QueryCache.prototype.fetchQuery;
  clear: () => void;
  refetchQueries: (filter: { queryKey: QueryKey }) => Promise<void>;
};

export function useQueryClient(): QueryClient {
  const cache = useQueryCache();

  return useMemo(
    () => ({
      invalidate: (filter: InvalidateFilter) => cache.invalidate(filter),
      invalidateQueries: (filter: { queryKey: QueryKey; exact?: boolean }) =>
        cache.invalidateQueries(filter),
      setQueryData: <T>(key: QueryKey, data: T) => cache.setData(key, data),
      getQueryData: <T>(key: QueryKey) => cache.getQueryData<T>(key),
      fetchQuery: cache.fetchQuery.bind(cache),
      clear: () => cache.clear(),
      refetchQueries: async (filter: { queryKey: QueryKey }) => {
        const prefix = filter.queryKey;
        const keys = cache.getAllKeys().filter(
          (key) =>
            key.length >= prefix.length &&
            prefix.every((part, i) => key[i] === part),
        );
        await Promise.all(keys.map((key) => cache.refetchQuery(key)));
      },
    }),
    [cache],
  );
}
