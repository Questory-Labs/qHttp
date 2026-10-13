'use client';

import { useEffect, useRef } from 'react';
import { serializeResourceId } from '../resource/resource-id.js';
import type { LiveSubscribe, UseLiveResourceOptions } from '../resource/types.js';
import { subscribeSse } from '../sse/QEventSource.js';
import { useStore } from './context.js';
import { useResource } from './use-resource.js';

/** Resource fed by push events (SSE, WebSocket, etc.) on top of an initial load. */
export function useLiveResource<T>(options: UseLiveResourceOptions<T>) {
  const store = useStore();
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const resource = useResource<T>({
    id: options.id,
    load: options.load,
    request: options.request,
    when: options.when,
    freshFor: options.freshFor,
    gcTime: options.gcTime,
    keepPrevious: options.keepPrevious,
    retries: options.retries,
    retryDelay: options.retryDelay,
    backoff: options.backoff,
    maxDelay: options.maxDelay,
    jitter: options.jitter,
  });

  const idStr = serializeResourceId(options.id);
  const when = options.when ?? true;
  const sseKey =
    typeof options.sse === 'string' ? options.sse : options.sse ? serializeResourceId([options.sse]) : '';

  useEffect(() => {
    if (!when) return;
    const current = optionsRef.current;
    const subscribe: LiveSubscribe | undefined = current.subscribe ?? sseSubscriber(current.sse);
    if (!subscribe) return;

    const ac = new AbortController();
    void subscribe((raw) => {
      const opts = optionsRef.current;
      try {
        const parse = opts.parse ?? (JSON.parse as (raw: string) => T);
        const incoming = parse(raw);
        const next = opts.merge ? opts.merge(store.peek<T>(opts.id), incoming) : incoming;
        store.push(opts.id, next);
      } catch {
        // ignore malformed frames
      }
    }, ac.signal);
    return () => ac.abort();
    // Re-subscribe only when the id, enablement or SSE target changes.
  }, [store, when, idStr, sseKey]);

  return resource;
}

function sseSubscriber<T>(sse: UseLiveResourceOptions<T>['sse']): LiveSubscribe | undefined {
  if (!sse) return undefined;
  const target = typeof sse === 'string' ? { url: sse } : sse;
  return (onEvent, signal) => {
    subscribeSse(
      target.url,
      {
        onMessage: (message) => {
          if (target.event && message.event !== target.event) return;
          onEvent(message.data);
        },
        headers: target.headers,
        fetchOptions: target.withCredentials ? { credentials: 'include' } : undefined,
      },
      signal,
    );
  };
}

export type UseLiveResourceResult<T> = ReturnType<typeof useLiveResource<T>>;
