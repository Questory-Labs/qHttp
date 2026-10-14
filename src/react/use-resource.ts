'use client';

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { loadFromRequest } from '../resource/load-from-request.js';
import { serializeResourceId } from '../resource/resource-id.js';
import type { LoadOpts, ResourceSnapshot, UseResourceOptions } from '../resource/types.js';
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
    gcTime: options.gcTime,
    retries: options.retries,
    retryDelay: options.retryDelay,
    backoff: options.backoff,
    maxDelay: options.maxDelay,
    jitter: options.jitter,
  };
}

function sameSnapshot<T>(a: ResourceSnapshot<T>, b: ResourceSnapshot<T>): boolean {
  return (
    a.value === b.value &&
    a.error === b.error &&
    a.empty === b.empty &&
    a.busy === b.busy &&
    a.refreshing === b.refreshing &&
    a.updatedAt === b.updatedAt
  );
}

export function useResource<T>(options: UseResourceOptions<T>) {
  const store = useStore();
  const when = options.when ?? true;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const whenRef = useRef(when);
  whenRef.current = when;

  const idStr = serializeResourceId(options.id);
  const refreshEveryDep =
    typeof options.refreshEvery === 'function' ? 'fn' : (options.refreshEvery ?? false);
  const refreshOnFocus = Boolean(options.refreshOnFocus);

  const subscribe = useCallback(
    (onStoreChange: () => void) => store.observe(optionsRef.current.id, onStoreChange),
    [store, idStr],
  );

  const snapRef = useRef<ResourceSnapshot<T>>(store.snapshot<T>(options.id));
  const getSnapshot = useCallback(() => {
    const next = store.snapshot<T>(optionsRef.current.id);
    if (sameSnapshot(snapRef.current, next)) return snapRef.current;
    snapRef.current = next;
    return next;
  }, [store, idStr]);

  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const schedulerRef = useRef<RefreshScheduler | null>(null);
  const lastFocusAtRef = useRef(0);

  const resolveLoad = useCallback((): (() => Promise<T>) | undefined => {
    const current = optionsRef.current;
    if (current.load) return current.load;
    if (current.request) return loadFromRequest<T>(current.request);
    return undefined;
  }, []);

  const reload = useCallback(async (): Promise<T | undefined> => {
    if (!whenRef.current) return store.peek<T>(optionsRef.current.id);
    const load = resolveLoad();
    if (!load) return store.peek<T>(optionsRef.current.id);
    return store.reload(optionsRef.current.id, load, toLoadOpts(optionsRef.current));
  }, [store, resolveLoad]);

  // Load when enabled, when the id changes, and again if the entry was dropped
  // (empty + never loaded + idle). Independent of `load` identity.
  const needsLoad = when && snap.empty && !snap.busy && snap.updatedAt === 0 && snap.error === null;
  useEffect(() => {
    if (!needsLoad) return;
    const load = resolveLoad();
    if (!load) return;
    void store
      .ensure(optionsRef.current.id, load, toLoadOpts(optionsRef.current))
      .catch(() => undefined);
  }, [store, idStr, needsLoad, resolveLoad]);

  useEffect(() => {
    if (!when || refreshEveryDep === false) {
      schedulerRef.current?.dispose();
      schedulerRef.current = null;
      return;
    }

    const scheduler = new RefreshScheduler({
      getInterval: () =>
        resolveInterval(optionsRef.current.refreshEvery, store.peek<T>(optionsRef.current.id)),
      refresh: async () => {
        const load = resolveLoad();
        await store.reload(optionsRef.current.id, load, toLoadOpts(optionsRef.current));
      },
    });
    schedulerRef.current = scheduler;
    scheduler.sync();
    const unsub = store.observe(optionsRef.current.id, () => scheduler.sync());

    return () => {
      unsub();
      scheduler.dispose();
      if (schedulerRef.current === scheduler) schedulerRef.current = null;
    };
  }, [store, when, idStr, refreshEveryDep, resolveLoad]);

  useEffect(() => {
    if (!when || !refreshOnFocus) return;
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const onVisible = () => {
      if (document.visibilityState === 'hidden') return;
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
      void reload().catch(() => undefined);
    };

    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [store, when, idStr, refreshOnFocus, reload]);

  // keepPrevious: show the last known value while a different id loads.
  const previousRef = useRef<T | undefined>(undefined);
  if (snap.value !== undefined) previousRef.current = snap.value;
  const placeholder = Boolean(options.keepPrevious) && snap.value === undefined && previousRef.current !== undefined;
  const value = placeholder ? previousRef.current : snap.value;

  return {
    ...snap,
    value,
    empty: placeholder ? false : snap.empty,
    placeholder,
    reload,
    failed: snap.error !== null,
    ready: !snap.empty && snap.error === null,
  };
}

export type UseResourceResult<T> = ReturnType<typeof useResource<T>>;
