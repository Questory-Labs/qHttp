import { describe, expect, it } from 'vitest';
import { HookManager } from '../../src/interceptors/hook-manager.js';

describe('HookManager', () => {
  it('runs hooks in registration order and merges patches', async () => {
    const manager = new HookManager();
    const order: number[] = [];

    manager.add('preRequest', () => {
      order.push(1);
      return { a: 1 };
    });
    manager.add('preRequest', () => {
      order.push(2);
      return { b: 2 };
    });

    const ctx = await manager.run('preRequest', {} as { a?: number; b?: number });
    expect(order).toEqual([1, 2]);
    expect(ctx).toEqual({ a: 1, b: 2 });
  });

  it('short-circuits on first onError recovery', async () => {
    const manager = new HookManager();
    manager.add('onError', () => ({ data: 'recovered', httpStatus: 200 }));
    manager.add('onError', () => ({ data: 'ignored' }));

    const recovered = await manager.runErrorHooks(new Error('x'));
    expect(recovered).toEqual({ data: 'recovered', httpStatus: 200 });
  });
});
