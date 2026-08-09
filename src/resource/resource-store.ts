import { idsMatchPrefix, serializeResourceId } from './resource-id.js';
import {
  resolveResourceRetry,
  runWithRetry,
  type ResolvedResourceRetry,
} from './retry.js';
import type { LoadOpts, ResourceDefaults, ResourceId, ResourceSnapshot } from './types.js';

type InternalEntry<T = unknown> = {
  id: ResourceId;
  idStr: string;
  value: T | undefined;
  error: Error | null;
  updatedAt: number;
  freshFor: number;
  retry: ResolvedResourceRetry;
  load?: () => Promise<T>;
  listeners: Set<() => void>;
  inFlight?: Promise<T>;
  abort?: AbortController;
  /** Bumped to ignore stale in-flight results after reload/drop. */
  generation: number;
  stale: boolean;
};

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

function notify(entry: InternalEntry) {
  for (const listener of entry.listeners) {
    listener();
  }
}

export class ResourceStore {
  private entries = new Map<string, InternalEntry>();
  private defaults: ResourceDefaults = {};

  constructor(defaults?: ResourceDefaults) {
    if (defaults) this.defaults = { ...defaults };
  }

  configureDefaults(defaults: ResourceDefaults): void {
    this.defaults = { ...this.defaults, ...defaults };
  }

  getDefaults(): ResourceDefaults {
    return { ...this.defaults };
  }

  peek<T>(id: ResourceId): T | undefined {
    return this.entries.get(serializeResourceId(id))?.value as T | undefined;
  }

  snapshot<T>(id: ResourceId): ResourceSnapshot<T> {
    const entry = this.entries.get(serializeResourceId(id));
    if (!entry) {
      return {
        value: undefined,
        error: null,
        empty: true,
        busy: false,
        refreshing: false,
        updatedAt: 0,
      };
    }
    const empty = entry.value === undefined;
    const busy = entry.inFlight !== undefined;
    return {
      value: entry.value as T | undefined,
      error: entry.error,
      empty,
      busy,
      refreshing: busy && !empty,
      updatedAt: entry.updatedAt,
    };
  }

  observe(id: ResourceId, listener: () => void): () => void {
    const idStr = serializeResourceId(id);
    let entry = this.entries.get(idStr);
    if (!entry) {
      entry = this.createEntry(id, idStr);
      this.entries.set(idStr, entry);
    }
    entry.listeners.add(listener);
    return () => {
      entry!.listeners.delete(listener);
      if (
        entry!.listeners.size === 0 &&
        entry!.value === undefined &&
        !entry!.inFlight &&
        entry!.updatedAt === 0
      ) {
        this.entries.delete(idStr);
      }
    };
  }

  push<T>(id: ResourceId, value: T): void {
    const idStr = serializeResourceId(id);
    let entry = this.entries.get(idStr);
    if (!entry) {
      entry = this.createEntry(id, idStr);
      this.entries.set(idStr, entry);
    }
    entry.value = value;
    entry.error = null;
    entry.updatedAt = Date.now();
    entry.stale = false;
    notify(entry);
  }

  async ensure<T>(
    id: ResourceId,
    load: () => Promise<T>,
    opts?: LoadOpts,
  ): Promise<T> {
    const freshFor = opts?.freshFor ?? this.defaults.freshFor ?? 0;
    const retry = resolveResourceRetry(opts, this.defaults);
    const idStr = serializeResourceId(id);
    let entry = this.entries.get(idStr) as InternalEntry<T> | undefined;

    if (!entry) {
      entry = this.createEntry(id, idStr, freshFor, retry) as InternalEntry<T>;
      this.entries.set(idStr, entry);
    } else {
      entry.freshFor = freshFor;
      entry.retry = retry;
    }

    entry.load = load;

    const now = Date.now();
    const isStale =
      entry.stale ||
      entry.updatedAt === 0 ||
      now - entry.updatedAt > entry.freshFor;

    if (entry.value !== undefined && !isStale && !entry.inFlight) {
      return entry.value as T;
    }

    if (entry.inFlight) {
      return entry.inFlight;
    }

    return this.startLoad(entry, load);
  }

  async reload<T>(
    id: ResourceId,
    load?: () => Promise<T>,
    opts?: LoadOpts,
  ): Promise<T> {
    const idStr = serializeResourceId(id);
    let entry = this.entries.get(idStr) as InternalEntry<T> | undefined;
    const fn = load ?? (entry?.load as (() => Promise<T>) | undefined);
    if (!fn) {
      throw new Error(`No load registered for resource ${idStr}`);
    }

    if (!entry) {
      return this.ensure(id, fn, opts);
    }

    if (opts) {
      entry.freshFor = opts.freshFor ?? entry.freshFor;
      entry.retry = resolveResourceRetry(opts, this.defaults);
    }
    entry.stale = true;
    entry.load = fn;
    return this.startLoad(entry, fn);
  }

  touch(target: ResourceId | ResourceId[]): void {
    const targets = Array.isArray(target[0])
      ? (target as ResourceId[])
      : [target as ResourceId];
    const reloadTargets: InternalEntry[] = [];

    for (const prefix of targets) {
      for (const entry of this.entries.values()) {
        if (!idsMatchPrefix(entry.id, prefix)) continue;
        entry.stale = true;
        notify(entry);
        if (entry.listeners.size > 0 && entry.load) {
          reloadTargets.push(entry);
        }
      }
    }

    for (const entry of reloadTargets) {
      void this.reload(entry.id);
    }
  }

  drop(id?: ResourceId): void {
    if (!id) {
      for (const entry of this.entries.values()) {
        entry.generation += 1;
        entry.abort?.abort();
        entry.abort = undefined;
        entry.inFlight = undefined;
      }
      this.entries.clear();
      return;
    }

    const toRemove: string[] = [];
    for (const entry of this.entries.values()) {
      if (
        idsMatchPrefix(entry.id, id) ||
        serializeResourceId(entry.id) === serializeResourceId(id)
      ) {
        entry.generation += 1;
        entry.abort?.abort();
        entry.abort = undefined;
        entry.inFlight = undefined;
        toRemove.push(entry.idStr);
      }
    }
    for (const key of toRemove) {
      this.entries.delete(key);
    }
  }

  getAllIds(): ResourceId[] {
    return [...this.entries.values()].map((e) => e.id);
  }

  private startLoad<T>(
    entry: InternalEntry<T>,
    load: () => Promise<T>,
  ): Promise<T> {
    entry.abort?.abort();
    const abort = new AbortController();
    entry.abort = abort;
    const generation = ++entry.generation;

    const promise = runWithRetry(load, entry.retry, abort.signal)
      .then((value) => {
        if (entry.generation !== generation) return value;
        entry.value = value;
        entry.error = null;
        entry.updatedAt = Date.now();
        entry.stale = false;
        entry.inFlight = undefined;
        if (entry.abort === abort) entry.abort = undefined;
        notify(entry);
        return value;
      })
      .catch((err) => {
        if (entry.generation === generation) {
          entry.error = toError(err);
          entry.inFlight = undefined;
          if (entry.abort === abort) entry.abort = undefined;
          notify(entry);
        }
        throw err;
      });

    entry.inFlight = promise;
    notify(entry);
    return promise;
  }

  private createEntry(
    id: ResourceId,
    idStr: string,
    freshFor?: number,
    retry?: ResolvedResourceRetry,
  ): InternalEntry {
    return {
      id,
      idStr,
      value: undefined,
      error: null,
      updatedAt: 0,
      freshFor: freshFor ?? this.defaults.freshFor ?? 0,
      retry: retry ?? resolveResourceRetry(undefined, this.defaults),
      listeners: new Set(),
      generation: 0,
      stale: false,
    };
  }
}
