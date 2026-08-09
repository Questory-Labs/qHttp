'use client';

import { useCallback, useRef, useState } from 'react';
import { useStore } from './context.js';
import type { UseActionOptions } from '../resource/types.js';

export function useAction<TData = unknown, TInput = void>(
  options: UseActionOptions<TData, TInput>,
) {
  const store = useStore();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [value, setValue] = useState<TData | undefined>(undefined);
  const [input, setInput] = useState<TInput | undefined>(undefined);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const submitAsync = useCallback(
    async (vars: TInput) => {
      setBusy(true);
      setFailed(false);
      setSucceeded(false);
      setError(null);
      setInput(vars);
      try {
        const result = await optionsRef.current.run(vars);
        setValue(result);
        setSucceeded(true);
        if (optionsRef.current.touches?.length) {
          store.touch(optionsRef.current.touches);
        }
        await optionsRef.current.onSuccess?.(result, vars);
        return result;
      } catch (err) {
        const typed = err instanceof Error ? err : new Error(String(err));
        setError(typed);
        setFailed(true);
        await optionsRef.current.onError?.(typed, vars);
        throw err;
      } finally {
        setBusy(false);
      }
    },
    [store],
  );

  const submit = useCallback(
    (vars: TInput) => {
      void submitAsync(vars);
    },
    [submitAsync],
  );

  const reset = useCallback(() => {
    setBusy(false);
    setFailed(false);
    setSucceeded(false);
    setError(null);
    setValue(undefined);
    setInput(undefined);
  }, []);

  return {
    submit,
    submitAsync,
    reset,
    busy,
    failed,
    succeeded,
    error,
    value,
    input,
  };
}

export type UseActionResult<TData, TInput> = ReturnType<
  typeof useAction<TData, TInput>
>;
