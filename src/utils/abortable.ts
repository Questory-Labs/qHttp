export type AbortReason = 'ABORTED' | 'TIMEOUT' | 'DEADLINE';

export interface ComposedSignal {
  signal: AbortSignal;
  cancel: () => void;
  cleanup: () => void;
  readonly reason?: AbortReason;
}

export interface ComposeSignalOptions {
  timeoutMs?: number;
  /** Reason reported when `timeoutMs` elapses. Default `'TIMEOUT'`. */
  timeoutReason?: AbortReason;
}

const reasons = new WeakMap<AbortSignal, ComposedSignal>();

/**
 * Compose an external signal and an optional timer into one signal.
 * `reason` records why the composed signal aborted. Reasons propagate from
 * composed parents to composed children.
 */
export function composeSignal(
  externalSignal?: AbortSignal,
  timeoutMs?: number | ComposeSignalOptions,
): ComposedSignal {
  const options: ComposeSignalOptions =
    typeof timeoutMs === 'number' ? { timeoutMs } : (timeoutMs ?? {});
  const controller = new AbortController();
  let reason: AbortReason | undefined;

  const onAbort = (abortReason: AbortReason) => {
    if (controller.signal.aborted) return;
    reason = abortReason;
    controller.abort();
  };

  const onExternalAbort = () => {
    onAbort(readAbortReason(externalSignal) ?? 'ABORTED');
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      onExternalAbort();
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  const timer =
    options.timeoutMs && options.timeoutMs > 0 && Number.isFinite(options.timeoutMs)
      ? setTimeout(() => onAbort(options.timeoutReason ?? 'TIMEOUT'), options.timeoutMs)
      : undefined;

  const composed: ComposedSignal = {
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
  reasons.set(controller.signal, composed);
  return composed;
}

/** Read the qhttp abort reason recorded on a composed signal, if any. */
export function readAbortReason(signal?: AbortSignal): AbortReason | undefined {
  if (!signal) return undefined;
  return reasons.get(signal)?.reason;
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
