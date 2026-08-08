import { keysMatchPrefix, serializeQueryKey } from './query-key.js';
import type {
  FetchQueryOptions,
  InvalidateFilter,
  QueryClientDefaults,
  QueryKey,
  QueryState,
} from './types.js';

type InternalEntry<T = unknown> = {
  key: QueryKey;
  keyId: string;
  state: QueryState<T>;
  staleTime: number;
  retry: number | false;
  queryFn?: () => Promise<T>;
  listeners: Set<() => void>;
  inFlight?: Promise<T>;
  invalidated: boolean;
};

function emptyState<T>(): QueryState<T> {
  return {
    data: undefined,
    error: undefined,
    status: 'idle',
    isFetching: false,
    dataUpdatedAt: 0,
    errorUpdatedAt: 0,
    fetchFailureCount: 0,
  };
}

function notify(entry: InternalEntry) {
  for (const listener of entry.listeners) {
    listener();
  }
}

function patchState<T>(
  entry: InternalEntry<T>,
  patch: Partial<QueryState<T>>,
): QueryState<T> {
  entry.state = { ...entry.state, ...patch };
  return entry.state;
}

async function runWithRetry<T>(
  fn: () => Promise<T>,
  retry: number | false,
): Promise<T> {
  const maxAttempts = retry === false ? 1 : retry + 1;
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt >= maxAttempts - 1) break;
    }
  }
  throw lastError;
}

export class QueryCache {
  private entries = new Map<string, InternalEntry>();
  private defaults: QueryClientDefaults = {};

  constructor(options?: { defaultOptions?: { queries?: QueryClientDefaults } }) {
    if (options?.defaultOptions?.queries) {
      this.configureDefaults(options.defaultOptions.queries);
    }
  }

  configureDefaults(defaults: QueryClientDefaults): void {
    this.defaults = { ...this.defaults, ...defaults };
  }

  getDefaults(): QueryClientDefaults {
    return { ...this.defaults };
  }

  getQueryState<T>(key: QueryKey): QueryState<T> | undefined {
    const entry = this.entries.get(serializeQueryKey(key));
    return entry ? (entry.state as QueryState<T>) : undefined;
  }

  getQueryData<T>(key: QueryKey): T | undefined {
    const state = this.getQueryState<T>(key);
    return state?.data;
  }

  subscribe(key: QueryKey, listener: () => void): () => void {
    const keyId = serializeQueryKey(key);
    let entry = this.entries.get(keyId);
    if (!entry) {
      entry = {
        key,
        keyId,
        state: emptyState(),
        staleTime: this.defaults.staleTime ?? 0,
        retry: this.defaults.retry ?? 1,
        listeners: new Set(),
        invalidated: false,
      };
      this.entries.set(keyId, entry);
    }
    entry.listeners.add(listener);
    return () => entry!.listeners.delete(listener);
  }

  setData<T>(key: QueryKey, data: T): void {
    const keyId = serializeQueryKey(key);
    let entry = this.entries.get(keyId);
    if (!entry) {
      entry = {
        key,
        keyId,
        state: emptyState<T>(),
        staleTime: this.defaults.staleTime ?? 0,
        retry: this.defaults.retry ?? 1,
        listeners: new Set(),
        invalidated: false,
      };
      this.entries.set(keyId, entry);
    }
    patchState(entry as InternalEntry<T>, {
      data,
      error: undefined,
      status: 'success',
      isFetching: false,
      dataUpdatedAt: Date.now(),
    });
    entry.invalidated = false;
    notify(entry);
  }

  invalidate(filter: InvalidateFilter): void {
    const exact = typeof filter === 'object' && 'queryKey' in filter && filter.exact;
    const prefix =
      typeof filter === 'object' && 'queryKey' in filter ? filter.queryKey : filter;

    const refetchTargets: InternalEntry[] = [];

    for (const entry of this.entries.values()) {
      const matches = exact
        ? serializeQueryKey(entry.key) === serializeQueryKey(prefix)
        : keysMatchPrefix(entry.key, prefix);
      if (!matches) continue;
      entry.invalidated = true;
      notify(entry);
      if (entry.listeners.size > 0 && entry.queryFn) {
        refetchTargets.push(entry);
      }
    }

    for (const entry of refetchTargets) {
      void this.refetchQuery(entry.key, entry.queryFn as () => Promise<unknown>);
    }
  }

  invalidateQueries(filter: { queryKey: QueryKey; exact?: boolean }): void {
    this.invalidate(filter);
  }

  async fetchQuery<T>(options: FetchQueryOptions<T>): Promise<T> {
    const staleTime = options.staleTime ?? this.defaults.staleTime ?? 0;
    const retry = options.retry ?? this.defaults.retry ?? 1;
    const keyId = serializeQueryKey(options.key);
    let entry = this.entries.get(keyId) as InternalEntry<T> | undefined;

    if (!entry) {
      entry = {
        key: options.key,
        keyId,
        state: emptyState<T>(),
        staleTime,
        retry,
        queryFn: options.queryFn,
        listeners: new Set(),
        invalidated: false,
      };
      this.entries.set(keyId, entry);
    } else {
      entry.queryFn = options.queryFn;
      entry.staleTime = staleTime;
      entry.retry = retry;
    }

    const state = entry.state;
    const now = Date.now();
    const isStale =
      entry.invalidated ||
      state.dataUpdatedAt === 0 ||
      now - state.dataUpdatedAt > staleTime;

    if (state.data !== undefined && !isStale && !state.isFetching) {
      return state.data as T;
    }

    if (entry.inFlight) {
      return entry.inFlight;
    }

    const isInitial = state.data === undefined;
    patchState(entry, {
      status: isInitial ? 'loading' : state.status,
      isFetching: true,
    });
    notify(entry);

    const promise = runWithRetry(options.queryFn, retry)
      .then((data) => {
        patchState(entry, {
          data,
          error: undefined,
          status: 'success',
          isFetching: false,
          dataUpdatedAt: Date.now(),
          fetchFailureCount: 0,
        });
        entry.invalidated = false;
        entry.inFlight = undefined;
        notify(entry);
        return data;
      })
      .catch((error) => {
        patchState(entry, {
          error,
          status: 'error',
          isFetching: false,
          errorUpdatedAt: Date.now(),
          fetchFailureCount: state.fetchFailureCount + 1,
        });
        entry.inFlight = undefined;
        notify(entry);
        throw error;
      });

    entry.inFlight = promise;
    return promise;
  }

  async refetchQuery<T>(key: QueryKey, queryFn?: () => Promise<T>): Promise<T> {
    const keyId = serializeQueryKey(key);
    const entry = this.entries.get(keyId);
    if (!entry) {
      if (!queryFn) {
        throw new Error(`No query registered for key ${keyId}`);
      }
      return this.fetchQuery({ key, queryFn });
    }
    entry.invalidated = true;
    const fn = queryFn ?? (entry.queryFn as () => Promise<T>);
    if (!fn) {
      throw new Error(`No queryFn for key ${keyId}`);
    }
    return this.fetchQuery({
      key,
      queryFn: fn,
      staleTime: entry.staleTime,
      retry: entry.retry,
    });
  }

  getAllKeys(): QueryKey[] {
    return [...this.entries.values()].map((e) => e.key);
  }

  clear(): void {
    for (const entry of this.entries.values()) {
      entry.inFlight = undefined;
    }
    this.entries.clear();
  }
}
