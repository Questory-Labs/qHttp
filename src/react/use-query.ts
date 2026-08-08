'use client';

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { useQueryCache } from './context.js';
import type { QueryState, UseQueryOptions } from '../query/types.js';

function deriveFlags<T>(state: QueryState<T> | undefined, enabled: boolean) {
  const status = state?.status ?? 'idle';
  const data = state?.data;
  const isFetching = state?.isFetching ?? false;
  const isPending = enabled && data === undefined && (status === 'loading' || isFetching);
  const isLoading = isPending;
  const isSuccess = status === 'success';
  const isError = status === 'error';

  return {
    data,
    error: state?.error,
    status,
    isFetching,
    isPending,
    isLoading,
    isSuccess,
    isError,
    isFetched: (state?.dataUpdatedAt ?? 0) > 0 || status === 'error',
    fetchFailureCount: state?.fetchFailureCount ?? 0,
    dataUpdatedAt: state?.dataUpdatedAt ?? 0,
  };
}

function resolveIntervalMs<T>(
  interval: UseQueryOptions<T>['refetchInterval'],
  data: T | undefined,
): number | false {
  if (interval === false || interval === undefined) return false;
  if (typeof interval === 'function') {
    return interval({ data, state: { data } });
  }
  return interval;
}

export function useQuery<T>(options: UseQueryOptions<T>) {
  const cache = useQueryCache();
  const enabled = options.enabled ?? true;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const keyId = JSON.stringify(options.queryKey);

  const subscribe = useCallback(
    (onStoreChange: () => void) => cache.subscribe(options.queryKey, onStoreChange),
    [cache, keyId],
  );

  const getSnapshot = useCallback(
    () => cache.getQueryState<T>(options.queryKey),
    [cache, keyId],
  );

  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const flags = deriveFlags(state, enabled);
  const intervalOpt = options.refetchInterval;
  const intervalDep =
    typeof intervalOpt === 'function' ? 'fn' : (intervalOpt ?? false);

  const fetchNow = useCallback(async () => {
    if (!enabled) return flags.data as T | undefined;
    return cache.fetchQuery<T>({
      key: optionsRef.current.queryKey,
      queryFn: optionsRef.current.queryFn,
      staleTime: optionsRef.current.staleTime,
      retry: optionsRef.current.retry,
    });
  }, [cache, enabled]);

  useEffect(() => {
    if (!enabled) return;
    void cache
      .fetchQuery<T>({
        key: optionsRef.current.queryKey,
        queryFn: optionsRef.current.queryFn,
        staleTime: optionsRef.current.staleTime,
        retry: optionsRef.current.retry,
      })
      .catch(() => undefined);
  }, [cache, enabled, keyId]);

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setInterval> | undefined;
    let lastMs: number | false | undefined;

    const schedule = () => {
      const data = cache.getQueryState<T>(optionsRef.current.queryKey)?.data;
      const ms = resolveIntervalMs(optionsRef.current.refetchInterval, data);
      if (ms === lastMs) return;
      lastMs = ms;
      if (timer) clearInterval(timer);
      timer = undefined;
      if (ms === false || ms <= 0) return;
      timer = setInterval(() => {
        void cache
          .refetchQuery<T>(
            optionsRef.current.queryKey,
            optionsRef.current.queryFn,
          )
          .catch(() => undefined);
      }, ms);
    };

    schedule();
    const unsub = cache.subscribe(optionsRef.current.queryKey, schedule);

    return () => {
      unsub();
      if (timer) clearInterval(timer);
    };
  }, [cache, enabled, keyId, intervalDep]);

  useEffect(() => {
    if (!enabled || !optionsRef.current.refetchOnWindowFocus) return;
    const onFocus = () => {
      void cache
        .refetchQuery<T>(
          optionsRef.current.queryKey,
          optionsRef.current.queryFn,
        )
        .catch(() => undefined);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [cache, enabled, keyId]);

  return {
    ...flags,
    refetch: fetchNow,
  };
}

export type UseQueryResult<T> = ReturnType<typeof useQuery<T>>;
