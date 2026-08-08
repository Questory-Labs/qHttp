export type AbortReason = 'ABORTED' | 'TIMEOUT';

export interface ComposedSignal {
  signal: AbortSignal;
  cancel: () => void;
  cleanup: () => void;
  reason?: AbortReason;
}

export function composeSignal(
  externalSignal?: AbortSignal,
  timeoutMs?: number,
): ComposedSignal {
  const controller = new AbortController();
  let reason: AbortReason | undefined;

  const onAbort = (abortReason: AbortReason) => {
    if (controller.signal.aborted) return;
    reason = abortReason;
    controller.abort();
  };

  const onExternalAbort = () => onAbort('ABORTED');

  if (externalSignal) {
    if (externalSignal.aborted) {
      onAbort('ABORTED');
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  const timer =
    timeoutMs && timeoutMs > 0
      ? setTimeout(() => onAbort('TIMEOUT'), timeoutMs)
      : undefined;

  return {
    signal: controller.signal,
    cancel: () => onAbort('ABORTED'),
    cleanup: () => {
      if (timer) clearTimeout(timer);
      externalSignal?.removeEventListener('abort', onExternalAbort);
    },
    get reason() {
      return reason;
    },
  };
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
