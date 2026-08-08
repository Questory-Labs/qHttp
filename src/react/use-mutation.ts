'use client';

import { useCallback, useState } from 'react';
import type { UseMutationOptions } from '../query/types.js';

export function useMutation<TData = unknown, TVariables = void>(
  options: UseMutationOptions<TData, TVariables>,
) {
  const [isPending, setIsPending] = useState(false);
  const [isError, setIsError] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<unknown>(undefined);
  const [data, setData] = useState<TData | undefined>(undefined);

  const mutateAsync = useCallback(
    async (variables: TVariables) => {
      setIsPending(true);
      setIsError(false);
      setIsSuccess(false);
      setError(undefined);
      try {
        await options.onMutate?.(variables);
        const result = await options.mutationFn(variables);
        setData(result);
        setIsSuccess(true);
        await options.onSuccess?.(result, variables);
        return result;
      } catch (err) {
        setError(err);
        setIsError(true);
        await options.onError?.(err, variables);
        throw err;
      } finally {
        setIsPending(false);
      }
    },
    [options],
  );

  const mutate = useCallback(
    (variables: TVariables) => {
      void mutateAsync(variables);
    },
    [mutateAsync],
  );

  return {
    mutate,
    mutateAsync,
    isPending,
    isError,
    isSuccess,
    error,
    data,
  };
}
