'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { ResourceStore } from '../resource/resource-store.js';
import type { DehydratedResource, ResourceDefaults } from '../resource/types.js';

export type ResourceProviderProps = {
  children: ReactNode;
  store?: ResourceStore;
  /** @deprecated use `store` */
  client?: ResourceStore;
  defaults?: ResourceDefaults;
  /** Values from `store.dehydrate()` on the server, applied before first render. */
  hydrate?: readonly DehydratedResource[];
};

const ResourceStoreContext = createContext<ResourceStore | null>(null);

export function ResourceProvider({ children, store, client, defaults, hydrate }: ResourceProviderProps) {
  const [owned] = useState(() => {
    const created = store ?? client ?? new ResourceStore(defaults);
    if (hydrate?.length) created.hydrate(hydrate);
    return created;
  });
  const resourceStore = store ?? client ?? owned;

  useEffect(() => {
    if (defaults) resourceStore.configureDefaults(defaults);
  }, [resourceStore, defaults]);

  return <ResourceStoreContext.Provider value={resourceStore}>{children}</ResourceStoreContext.Provider>;
}

export function useStore(): ResourceStore {
  const store = useContext(ResourceStoreContext);
  if (!store) {
    throw new Error('useStore must be used within ResourceProvider');
  }
  return store;
}
