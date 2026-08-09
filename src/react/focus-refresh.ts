import type { ResourceSnapshot } from '../resource/types.js';

export type FocusRefreshInput = {
  snapshot: Pick<ResourceSnapshot<unknown>, 'error' | 'updatedAt'>;
  freshFor: number;
  now: number;
  lastAttemptAt: number;
  /** Minimum ms between focus-driven reloads (default 60s). */
  cooldownMs?: number;
};

/**
 * Whether a focus/visibility event should trigger a resource reload.
 * - Always respects cooldown.
 * - Errored resources may refresh after cooldown.
 * - Healthy resources refresh only when stale per `freshFor` (or never cached).
 */
export function shouldRefreshOnFocus(input: FocusRefreshInput): boolean {
  const cooldown = input.cooldownMs ?? 60_000;
  if (input.now - input.lastAttemptAt < cooldown) return false;

  if (input.snapshot.error) return true;

  if (input.snapshot.updatedAt === 0) return true;
  if (input.freshFor <= 0) return true;
  return input.now - input.snapshot.updatedAt > input.freshFor;
}
