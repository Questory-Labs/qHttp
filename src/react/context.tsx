'use client';

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { QueryCache } from '../query/query-cache.js';
import type { QueryClientDefaults } from '../query/types.js';

export type QHttpQueryProviderProps = {
  children: ReactNode;
  client?: QueryCache;
  defaultOptions?: {
    queries?: QueryClientDefaults;
  };
};

const QueryCacheContext = createContext<QueryCache | null>(null);

export function QHttpQueryProvider({
  children,
  client,
  defaultOptions,
}: QHttpQueryProviderProps) {
  const [owned] = useState(
    () =>
      new QueryCache(
        defaultOptions?.queries
          ? { defaultOptions: { queries: defaultOptions.queries } }
          : undefined,
      ),
  );
  const cache = client ?? owned;
  const defaultsApplied = useRef(false);

  useEffect(() => {
    if (defaultsApplied.current || !defaultOptions?.queries) return;
    cache.configureDefaults(defaultOptions.queries);
    defaultsApplied.current = true;
  }, [cache, defaultOptions]);

  return (
    <QueryCacheContext.Provider value={cache}>{children}</QueryCacheContext.Provider>
  );
}

export function useQueryCache(): QueryCache {
  const cache = useContext(QueryCacheContext);
  if (!cache) {
    throw new Error('useQueryCache must be used within QHttpQueryProvider');
  }
  return cache;
}
