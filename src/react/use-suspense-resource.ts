'use client';

import { loadFromRequest } from '../resource/load-from-request.js';
import type { UseResourceOptions } from '../resource/types.js';
import { useStore } from './context.js';
import { useResource } from './use-resource.js';

/**
 * Suspense variant: suspends until the first value is available and throws
 * load errors to the nearest error boundary. `value` is never undefined.
 */
export function useSuspenseResource<T>(options: Omit<UseResourceOptions<T>, 'when'>) {
  const store = useStore();
  const resource = useResource<T>(options);

  if (resource.value === undefined) {
    if (resource.error) throw resource.error;
    const load = options.load ?? (options.request ? loadFromRequest<T>(options.request) : undefined);
    if (!load) throw new Error('useSuspenseResource requires `load` or `request`');
    throw store.ensure(options.id, load, {
      freshFor: options.freshFor,
      gcTime: options.gcTime,
      retries: options.retries,
      retryDelay: options.retryDelay,
      backoff: options.backoff,
      maxDelay: options.maxDelay,
      jitter: options.jitter,
    });
  }

  return { ...resource, value: resource.value as T };
}

export type UseSuspenseResourceResult<T> = ReturnType<typeof useSuspenseResource<T>>;
