'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { ResourceStore } from '../resource/resource-store.js';
import type { ResourceDefaults } from '../resource/types.js';

export type ResourceProviderProps = {
  children: ReactNode;
  store?: ResourceStore;
  /** @deprecated use `store` */
  client?: ResourceStore;
  defaults?: ResourceDefaults;
};

const ResourceStoreContext = createContext<ResourceStore | null>(null);

export function ResourceProvider({
  children,
  store,
  client,
  defaults,
}: ResourceProviderProps) {
  const [owned] = useState(() => new ResourceStore(defaults));
  const resourceStore = store ?? client ?? owned;

  useEffect(() => {
    if (defaults) resourceStore.configureDefaults(defaults);
  }, [resourceStore, defaults]);

  return (
    <ResourceStoreContext.Provider value={resourceStore}>
      {children}
    </ResourceStoreContext.Provider>
  );
}

export function useStore(): ResourceStore {
  const store = useContext(ResourceStoreContext);
  if (!store) {
    throw new Error('useStore must be used within ResourceProvider');
  }
  return store;
}
