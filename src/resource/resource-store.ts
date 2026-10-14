import { idsMatchPrefix, serializeResourceId } from './resource-id.js';
import { resolveResourceRetry, runWithRetry, type ResolvedResourceRetry } from './retry.js';
import type {
  DehydratedResource,
  LoadOpts,
  ResourceDefaults,
  ResourceId,
  ResourceSnapshot,
} from './types.js';

type InternalEntry<T = unknown> = {
  id: ResourceId;
  idStr: string;
  value: T | undefined;
  error: Error | null;
  updatedAt: number;
  freshFor: number;
  gcTime: number;
  retry: ResolvedResourceRetry;
  load?: () => Promise<T>;
  listeners: Set<() => void>;
  inFlight?: Promise<T>;
  abort?: AbortController;
  /** Bumped to ignore stale in-flight results after reload/drop. */
  generation: number;
  /** Bumped on push; a load that started before a push must not overwrite it. */
  pushSeq: number;
  stale: boolean;
  gcTimer?: ReturnType<typeof setTimeout>;
};

export const DEFAULT_GC_TIME = 5 * 60_000;

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

function notify(entry: InternalEntry) {
  for (const listener of entry.listeners) {
    listener();
  }
}

/**
 * Framework-agnostic resource cache: dedupes loads, tracks freshness,
 * notifies observers, collects unobserved entries after `gcTime`.
 */
export class ResourceStore {
  private entries = new Map<string, InternalEntry>();
  private defaults: ResourceDefaults = {};
  private globalListeners = new Set<(id: ResourceId) => void>();

  constructor(defaults?: ResourceDefaults) {
    if (defaults) this.defaults = { ...defaults };
  }

  configureDefaults(defaults: ResourceDefaults): void {
    this.defaults = { ...this.defaults, ...defaults };
  }

  getDefaults(): ResourceDefaults {
    return { ...this.defaults };
  }

  has(id: ResourceId): boolean {
    return this.entries.has(serializeResourceId(id));
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
    this.cancelGc(entry);
    entry.listeners.add(listener);
    return () => {
      entry!.listeners.delete(listener);
      if (entry!.listeners.size > 0) return;
      if (entry!.value === undefined && !entry!.inFlight && entry!.updatedAt === 0) {
        this.entries.delete(idStr);
        return;
      }
      this.scheduleGc(entry!);
    };
  }

  /** Notified with the id of every entry that changes. */
  subscribe(listener: (id: ResourceId) => void): () => void {
    this.globalListeners.add(listener);
    return () => {
      this.globalListeners.delete(listener);
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
    entry.pushSeq += 1;
    this.emit(entry);
    if (entry.listeners.size === 0) this.scheduleGc(entry);
  }

  /** Update a value in place via `updater`. */
  update<T>(id: ResourceId, updater: (previous: T | undefined) => T): void {
    this.push(id, updater(this.peek<T>(id)));
  }

  async ensure<T>(id: ResourceId, load: () => Promise<T>, opts?: LoadOpts): Promise<T> {
    const freshFor = opts?.freshFor ?? this.defaults.freshFor ?? 0;
    const retry = resolveResourceRetry(opts, this.defaults);
    const idStr = serializeResourceId(id);
    let entry = this.entries.get(idStr) as InternalEntry<T> | undefined;

    if (!entry) {
      entry = this.createEntry(id, idStr, freshFor, retry, opts?.gcTime) as InternalEntry<T>;
      this.entries.set(idStr, entry);
    } else {
      entry.freshFor = freshFor;
      entry.retry = retry;
      if (opts?.gcTime !== undefined) entry.gcTime = opts.gcTime;
    }

    entry.load = load;

    const now = Date.now();
    const isStale = entry.stale || entry.updatedAt === 0 || now - entry.updatedAt > entry.freshFor;

    if (entry.value !== undefined && !isStale && !entry.inFlight) {
      return entry.value as T;
    }

    if (entry.inFlight) {
      return entry.inFlight;
    }

    return this.startLoad(entry, load);
  }

  async reload<T>(id: ResourceId, load?: () => Promise<T>, opts?: LoadOpts): Promise<T> {
    const idStr = serializeResourceId(id);
    const entry = this.entries.get(idStr) as InternalEntry<T> | undefined;
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
      if (opts.gcTime !== undefined) entry.gcTime = opts.gcTime;
    }
    entry.stale = true;
    entry.load = fn;
    return this.startLoad(entry, fn);
  }

  /** Mark matching resources stale; observed ones reload immediately. */
  touch(target: ResourceId | ResourceId[]): void {
    const targets = Array.isArray(target[0]) ? (target as ResourceId[]) : [target as ResourceId];
    const reloadTargets: InternalEntry[] = [];

    for (const prefix of targets) {
      for (const entry of this.entries.values()) {
        if (!idsMatchPrefix(entry.id, prefix)) continue;
        entry.stale = true;
        this.emit(entry);
        if (entry.listeners.size > 0 && entry.load) {
          reloadTargets.push(entry);
        }
      }
    }

    for (const entry of reloadTargets) {
      void this.reload(entry.id).catch(() => undefined);
    }
  }

  /**
   * Remove matching resources. Unobserved entries are deleted; observed ones are
   * reset in place (so observers keep their subscription) and see an empty
   * snapshot, which makes `useResource` load again.
   */
  drop(id?: ResourceId): void {
    const dropped: InternalEntry[] = [];
    for (const entry of this.entries.values()) {
      if (id && !idsMatchPrefix(entry.id, id)) continue;
      dropped.push(entry);
    }
    for (const entry of dropped) {
      entry.generation += 1;
      entry.pushSeq += 1;
      entry.abort?.abort();
      entry.abort = undefined;
      entry.inFlight = undefined;
      entry.value = undefined;
      entry.error = null;
      entry.updatedAt = 0;
      entry.stale = false;
      entry.load = undefined;
      this.cancelGc(entry);
      if (entry.listeners.size === 0) this.entries.delete(entry.idStr);
    }
    for (const entry of dropped) {
      this.emit(entry);
    }
  }

  getAllIds(): ResourceId[] {
    return [...this.entries.values()].map((e) => e.id);
  }

  /** Serializable snapshot of loaded values (for SSR / persistence). */
  dehydrate(): DehydratedResource[] {
    const out: DehydratedResource[] = [];
    for (const entry of this.entries.values()) {
      if (entry.value === undefined) continue;
      out.push({ id: entry.id, value: entry.value, updatedAt: entry.updatedAt });
    }
    return out;
  }

  /** Load values produced by `dehydrate`. Newer in-memory values win unless `overwrite`. */
  hydrate(items: readonly DehydratedResource[], options: { overwrite?: boolean } = {}): void {
    for (const item of items) {
      const idStr = serializeResourceId(item.id);
      let entry = this.entries.get(idStr);
      if (entry && !options.overwrite && entry.updatedAt >= item.updatedAt) continue;
      if (!entry) {
        entry = this.createEntry(item.id, idStr);
        this.entries.set(idStr, entry);
      }
      entry.value = item.value;
      entry.error = null;
      entry.updatedAt = item.updatedAt;
      entry.stale = false;
      this.emit(entry);
      if (entry.listeners.size === 0) this.scheduleGc(entry);
    }
  }

  private emit(entry: InternalEntry): void {
    notify(entry);
    for (const listener of this.globalListeners) listener(entry.id);
  }

  private scheduleGc(entry: InternalEntry): void {
    this.cancelGc(entry);
    if (!Number.isFinite(entry.gcTime) || entry.gcTime < 0) return;
    const timer = setTimeout(() => {
      entry.gcTimer = undefined;
      if (entry.listeners.size > 0 || entry.inFlight) return;
      if (this.entries.get(entry.idStr) === entry) this.entries.delete(entry.idStr);
    }, entry.gcTime);
    (timer as { unref?: () => void }).unref?.();
    entry.gcTimer = timer;
  }

  private cancelGc(entry: InternalEntry): void {
    if (entry.gcTimer === undefined) return;
    clearTimeout(entry.gcTimer);
    entry.gcTimer = undefined;
  }

  private startLoad<T>(entry: InternalEntry<T>, load: () => Promise<T>): Promise<T> {
    entry.abort?.abort();
    const abort = new AbortController();
    entry.abort = abort;
    const generation = ++entry.generation;
    const pushSeq = entry.pushSeq;
    this.cancelGc(entry);

    const promise = runWithRetry(load, entry.retry, abort.signal)
      .then((value) => {
        if (entry.generation !== generation) return value;
        // A push during the load is newer than what the load returns.
        if (entry.pushSeq === pushSeq) {
          entry.value = value;
          entry.updatedAt = Date.now();
        } else {
          value = entry.value as T;
        }
        entry.error = null;
        entry.stale = false;
        entry.inFlight = undefined;
        if (entry.abort === abort) entry.abort = undefined;
        this.emit(entry);
        if (entry.listeners.size === 0) this.scheduleGc(entry);
        return value;
      })
      .catch((err) => {
        if (entry.generation === generation) {
          entry.error = toError(err);
          entry.inFlight = undefined;
          if (entry.abort === abort) entry.abort = undefined;
          this.emit(entry);
          if (entry.listeners.size === 0) this.scheduleGc(entry);
        }
        throw err;
      });

    entry.inFlight = promise;
    this.emit(entry);
    return promise;
  }

  private createEntry(
    id: ResourceId,
    idStr: string,
    freshFor?: number,
    retry?: ResolvedResourceRetry,
    gcTime?: number,
  ): InternalEntry {
    return {
      id,
      idStr,
      value: undefined,
      error: null,
      updatedAt: 0,
      freshFor: freshFor ?? this.defaults.freshFor ?? 0,
      gcTime: gcTime ?? this.defaults.gcTime ?? DEFAULT_GC_TIME,
      retry: retry ?? resolveResourceRetry(undefined, this.defaults),
      listeners: new Set(),
      generation: 0,
      pushSeq: 0,
      stale: false,
    };
  }
}
