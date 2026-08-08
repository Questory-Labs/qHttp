export type QueryKey = readonly unknown[];

export type QueryStatus = 'idle' | 'loading' | 'success' | 'error';

export type QueryState<T> = {
  data: T | undefined;
  error: unknown;
  status: QueryStatus;
  isFetching: boolean;
  dataUpdatedAt: number;
  errorUpdatedAt: number;
  fetchFailureCount: number;
};

export type FetchQueryOptions<T> = {
  key: QueryKey;
  queryFn: () => Promise<T>;
  staleTime?: number;
  retry?: number | false;
  enabled?: boolean;
};

export type InvalidateFilter =
  | QueryKey
  | { queryKey: QueryKey; exact?: boolean };

export type QueryClientDefaults = {
  staleTime?: number;
  retry?: number | false;
};

export type UseQueryOptions<T> = {
  queryKey: QueryKey;
  queryFn: () => Promise<T>;
  enabled?: boolean;
  staleTime?: number;
  retry?: number | false;
  refetchInterval?:
    | number
    | false
    | ((ctx: { data: T | undefined; state: { data: T | undefined } }) => number | false);
  refetchOnWindowFocus?: boolean;
};

export type UseMutationOptions<TData, TVariables> = {
  mutationFn: (variables: TVariables) => Promise<TData>;
  onSuccess?: (data: TData, variables: TVariables) => void | Promise<void>;
  onError?: (error: unknown, variables: TVariables) => void | Promise<void>;
  onMutate?: (variables: TVariables) => void | Promise<void>;
};
