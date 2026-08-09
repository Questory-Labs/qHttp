'use client';

import { useEffect, useRef } from 'react';
import { useStore } from './context.js';
import { useResource } from './use-resource.js';
import type { UseLiveResourceOptions } from '../resource/types.js';

/** Resource fed by push events (SSE, WebSocket, etc.) with an initial load. */
export function useLiveResource<T>(options: UseLiveResourceOptions<T>) {
  const store = useStore();
  const parseRef = useRef(options.parse ?? JSON.parse);
  parseRef.current = options.parse ?? JSON.parse;
  const subscribeRef = useRef(options.subscribe);
  subscribeRef.current = options.subscribe;

  const resource = useResource({
    id: options.id,
    load: options.load,
    request: options.request,
    when: options.when,
    freshFor: options.freshFor,
    retries: options.retries,
    retryDelay: options.retryDelay,
    backoff: options.backoff,
    maxDelay: options.maxDelay,
    jitter: options.jitter,
  });

  const idStr = JSON.stringify(options.id);
  const when = options.when ?? true;

  useEffect(() => {
    if (!when) return;
    const ac = new AbortController();
    void subscribeRef.current((raw) => {
      try {
        store.push(options.id, parseRef.current(raw) as T);
      } catch {
        // ignore malformed frames
      }
    }, ac.signal);
    return () => ac.abort();
  }, [store, when, idStr, options.id]);

  return resource;
}

export type UseLiveResourceResult<T> = ReturnType<typeof useLiveResource<T>>;
