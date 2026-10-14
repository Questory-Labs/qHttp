'use client';

import { useCallback, useRef, useState } from 'react';
import { useStore } from './context.js';
import type { ResourceId, UseActionOptions } from '../resource/types.js';

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
  const seqRef = useRef(0);

  const submitAsync = useCallback(
    async (vars: TInput) => {
      const seq = ++seqRef.current;
      const isCurrent = () => seq === seqRef.current;
      setBusy(true);
      setFailed(false);
      setSucceeded(false);
      setError(null);
      setInput(vars);

      const rollbacks: Array<[ResourceId, unknown, unknown]> = [];
      const optimistic = optionsRef.current.optimistic?.(vars) ?? [];
      for (const [id, updater] of optimistic) {
        const previous = store.peek(id);
        const applied = updater(previous);
        rollbacks.push([id, previous, applied]);
        store.push(id, applied);
      }

      try {
        const result = await optionsRef.current.run(vars);
        if (isCurrent()) {
          setValue(result);
          setSucceeded(true);
        }
        if (optionsRef.current.touches?.length) {
          store.touch(optionsRef.current.touches);
        }
        await optionsRef.current.onSuccess?.(result, vars);
        return result;
      } catch (err) {
        for (const [id, previous, applied] of rollbacks.reverse()) {
          // A newer write replaced our optimistic value; keep it.
          if (store.peek(id) !== applied) continue;
          if (previous === undefined) store.drop(id);
          else store.push(id, previous);
        }
        const typed = err instanceof Error ? err : new Error(String(err));
        if (isCurrent()) {
          setError(typed);
          setFailed(true);
        }
        await optionsRef.current.onError?.(typed, vars);
        throw err;
      } finally {
        if (isCurrent()) setBusy(false);
        await optionsRef.current.onSettled?.(vars);
      }
    },
    [store],
  );

  const submit = useCallback(
    (vars: TInput) => {
      submitAsync(vars).catch(() => undefined);
    },
    [submitAsync],
  );

  const reset = useCallback(() => {
    seqRef.current += 1;
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

export type UseActionResult<TData, TInput> = ReturnType<typeof useAction<TData, TInput>>;
