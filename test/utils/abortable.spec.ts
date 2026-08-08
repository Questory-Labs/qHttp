import { describe, expect, it } from 'vitest';
import { composeSignal, sleep } from '../../src/utils/abortable.js';

describe('abortable', () => {
  it('aborts on external signal', async () => {
    const controller = new AbortController();
    const composed = composeSignal(controller.signal, 5000);
    controller.abort();
    expect(composed.signal.aborted).toBe(true);
    composed.cleanup();
  });

  it('times out', async () => {
    const composed = composeSignal(undefined, 10);
    await sleep(20);
    expect(composed.signal.aborted).toBe(true);
    composed.cleanup();
  });

  it('sleep rejects when signal aborts', async () => {
    const controller = new AbortController();
    const promise = sleep(1000, controller.signal);
    controller.abort();
    await expect(promise).rejects.toThrow();
  });
});
