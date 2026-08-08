import type { HookFn, HookPhase } from '../core/types.js';

export class HookManager {
  readonly #hooks = new Map<HookPhase, HookFn[]>();

  add(phase: HookPhase, fn: HookFn): this {
    const existing = this.#hooks.get(phase) ?? [];
    existing.push(fn);
    this.#hooks.set(phase, existing);
    return this;
  }

  has(phase: HookPhase): boolean {
    const hooks = this.#hooks.get(phase);
    return !!hooks && hooks.length > 0;
  }

  async run<T extends object>(phase: HookPhase, ctx: T): Promise<T> {
    const hooks = this.#hooks.get(phase);
    if (!hooks || hooks.length === 0) {
      return ctx;
    }

    for (const fn of hooks) {
      const out = await fn(ctx);
      if (out !== undefined && typeof out === 'object') {
        Object.assign(ctx, out);
      }
    }

    return ctx;
  }

  async runErrorHooks(error: unknown): Promise<unknown> {
    const hooks = this.#hooks.get('onError');
    if (!hooks || hooks.length === 0) return undefined;

    for (const fn of hooks) {
      const recovered = await fn(error);
      if (recovered !== undefined) return recovered;
    }

    return undefined;
  }

  clone(): HookManager {
    const copy = new HookManager();
    for (const [phase, fns] of this.#hooks) {
      copy.#hooks.set(phase, [...fns]);
    }
    return copy;
  }
}
