'use client';

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { loadFromRequest } from '../resource/load-from-request.js';
import type { LoadOpts, UseResourceOptions } from '../resource/types.js';
import { useStore } from './context.js';
import { shouldRefreshOnFocus } from './focus-refresh.js';
import { RefreshScheduler } from './refresh-scheduler.js';

function resolveInterval<T>(
  refreshEvery: UseResourceOptions<T>['refreshEvery'],
  value: T | undefined,
): number | false {
  if (refreshEvery === false || refreshEvery === undefined) return false;
  if (typeof refreshEvery === 'function') return refreshEvery(value);
  return refreshEvery;
}

function toLoadOpts<T>(options: UseResourceOptions<T>): LoadOpts {
  return {
    freshFor: options.freshFor,
    retries: options.retries,
    retryDelay: options.retryDelay,
    backoff: options.backoff,
    maxDelay: options.maxDelay,
    jitter: options.jitter,
  };
}

export function useResource<T>(options: UseResourceOptions<T>) {
  const store = useStore();
  const when = options.when ?? true;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const idStr = JSON.stringify(options.id);
  const refreshEveryDep =
    typeof options.refreshEvery === 'function'
      ? 'fn'
      : (options.refreshEvery ?? false);
  const refreshOnFocus = Boolean(options.refreshOnFocus);

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
  const schedulerRef = useRef<RefreshScheduler | null>(null);
  const lastFocusAtRef = useRef(0);

  const resolveLoad = (): (() => Promise<T>) | undefined => {
    const current = optionsRef.current;
    if (current.load) return current.load;
    if (current.request) return loadFromRequest<T>(current.request);
    return undefined;
  };

  const reload = useCallback(async () => {
    if (!when) return snap.value;
    const load = resolveLoad();
    if (!load) return snap.value;
    return store.reload(
      optionsRef.current.id,
      load,
      toLoadOpts(optionsRef.current),
    );
  }, [store, when, snap.value]);

  // Load once per id. Do not depend on `load` identity — callers use inline lambdas.
  useEffect(() => {
    if (!when) return;
    const load = resolveLoad();
    if (!load) return;
    void store
      .ensure(optionsRef.current.id, load, toLoadOpts(optionsRef.current))
      .catch(() => undefined);
  }, [store, when, idStr]);

  useEffect(() => {
    if (!when || refreshEveryDep === false) {
      schedulerRef.current?.dispose();
      schedulerRef.current = null;
      return;
    }

    const scheduler = new RefreshScheduler({
      getInterval: () =>
        resolveInterval(
          optionsRef.current.refreshEvery,
          store.peek<T>(optionsRef.current.id),
        ),
      refresh: () => store.reload(optionsRef.current.id),
    });
    schedulerRef.current = scheduler;
    scheduler.sync();
    const unsub = store.observe(optionsRef.current.id, () => scheduler.sync());

    return () => {
      unsub();
      scheduler.dispose();
      if (schedulerRef.current === scheduler) schedulerRef.current = null;
    };
  }, [store, when, idStr, refreshEveryDep]);

  useEffect(() => {
    if (!when || !refreshOnFocus) return;

    const onVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }
      const current = optionsRef.current;
      const now = Date.now();
      if (
        !shouldRefreshOnFocus({
          snapshot: store.snapshot(current.id),
          freshFor: current.freshFor ?? store.getDefaults().freshFor ?? 0,
          now,
          lastAttemptAt: lastFocusAtRef.current,
        })
      ) {
        return;
      }
      lastFocusAtRef.current = now;
      schedulerRef.current?.resume();
      void store.reload(current.id).catch(() => undefined);
    };

    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [store, when, idStr, refreshOnFocus]);

  return {
    ...snap,
    reload,
    failed: snap.error !== null,
    ready: !snap.empty && snap.error === null,
  };
}

export type UseResourceResult<T> = ReturnType<typeof useResource<T>>;
