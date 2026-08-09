import { describe, expect, it } from 'vitest';
import { shouldRefreshOnFocus } from '../../src/react/focus-refresh.js';

describe('shouldRefreshOnFocus', () => {
  it('blocks within cooldown', () => {
    expect(
      shouldRefreshOnFocus({
        snapshot: { error: new Error('x'), updatedAt: 0 },
        freshFor: 30_000,
        now: 10_000,
        lastAttemptAt: 5_000,
        cooldownMs: 60_000,
      }),
    ).toBe(false);
  });

  it('allows errored resources after cooldown', () => {
    expect(
      shouldRefreshOnFocus({
        snapshot: { error: new Error('x'), updatedAt: 1_000 },
        freshFor: 30_000,
        now: 70_000,
        lastAttemptAt: 5_000,
      }),
    ).toBe(true);
  });

  it('skips fresh healthy resources', () => {
    expect(
      shouldRefreshOnFocus({
        snapshot: { error: null, updatedAt: 50_000 },
        freshFor: 30_000,
        now: 60_000,
        lastAttemptAt: 0,
      }),
    ).toBe(false);
  });

  it('refreshes stale healthy resources', () => {
    expect(
      shouldRefreshOnFocus({
        snapshot: { error: null, updatedAt: 10_000 },
        freshFor: 30_000,
        now: 80_000,
        lastAttemptAt: 0,
      }),
    ).toBe(true);
  });
});
