'use client';

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { loadFromRequest } from '../resource/load-from-request.js';
import { useStore } from './context.js';
import type { UseResourceOptions } from '../resource/types.js';

function resolveRefreshEvery<T>(
  interval: UseResourceOptions<T>['refreshEvery'],
  value: T | undefined,
): number | false {
  if (interval === false || interval === undefined) return false;
  if (typeof interval === 'function') return interval(value);
  return interval;
}

export function useResource<T>(options: UseResourceOptions<T>) {
  const store = useStore();
  const when = options.when ?? true;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const load = useMemo(() => {
    if (options.load) return options.load;
    if (options.request) return loadFromRequest<T>(options.request);
    return undefined;
  }, [options.load, options.request]);

  const idStr = JSON.stringify(options.id);

  const subscribe = useCallback(
    (onStoreChange: () => void) => store.observe(options.id, onStoreChange),
    [store, idStr],
  );

  const snapRef = useRef(store.snapshot<T>(options.id));

  const getSnapshot = useCallback(() => {
    const next = store.snapshot<T>(options.id);
    const prev = snapRef.current;
    if (
      prev.value === next.value &&
      prev.error === next.error &&
      prev.empty === next.empty &&
      prev.busy === next.busy &&
      prev.refreshing === next.refreshing &&
      prev.updatedAt === next.updatedAt
    ) {
      return prev;
    }
    snapRef.current = next;
    return next;
  }, [store, idStr]);

  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const intervalOpt = options.refreshEvery;
  const intervalDep =
    typeof intervalOpt === 'function' ? 'fn' : (intervalOpt ?? false);

  const reload = useCallback(async () => {
    if (!when || !load) return snap.value;
    return store.ensure(optionsRef.current.id, load, {
      freshFor: optionsRef.current.freshFor,
      retries: optionsRef.current.retries,
    });
  }, [store, when, load, snap.value]);

  useEffect(() => {
    if (!when || !load) return;
    void store
      .ensure(optionsRef.current.id, load, {
        freshFor: optionsRef.current.freshFor,
        retries: optionsRef.current.retries,
      })
      .catch(() => undefined);
  }, [store, when, idStr, load]);

  useEffect(() => {
    if (!when) return;

    let timer: ReturnType<typeof setInterval> | undefined;
    let lastMs: number | false | undefined;

    const schedule = () => {
      const value = store.peek<T>(optionsRef.current.id);
      const ms = resolveRefreshEvery(optionsRef.current.refreshEvery, value);
      if (ms === lastMs) return;
      lastMs = ms;
      if (timer) clearInterval(timer);
      timer = undefined;
      if (ms === false || ms <= 0) return;
      timer = setInterval(() => {
        void store.reload(optionsRef.current.id).catch(() => undefined);
      }, ms);
    };

    schedule();
    const unsub = store.observe(optionsRef.current.id, schedule);

    return () => {
      unsub();
      if (timer) clearInterval(timer);
    };
  }, [store, when, idStr, intervalDep]);

  useEffect(() => {
    if (!when || !optionsRef.current.refreshOnFocus) return;
    const onFocus = () => {
      void store.reload(optionsRef.current.id).catch(() => undefined);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [store, when, idStr]);

  return {
    ...snap,
    reload,
    failed: snap.error !== null,
    ready: !snap.empty && snap.error === null,
  };
}

export type UseResourceResult<T> = ReturnType<typeof useResource<T>>;
