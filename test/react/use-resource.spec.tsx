import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ResourceProvider, useResource, useStore } from '../../src/react/index.js';

function TestResource() {
  const r = useResource({
    id: ['hello'],
    load: async () => 'world',
  });
  return <div data-testid="out">{r.empty && r.busy ? 'loading' : r.value}</div>;
}

describe('useResource', () => {
  it('loads data through provider', async () => {
    render(
      <ResourceProvider>
        <TestResource />
      </ResourceProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('out').textContent).toBe('world');
    });
  });

  it('respects when=false', async () => {
    const fn = vi.fn(async () => 'nope');

    function Disabled() {
      const r = useResource({
        id: ['disabled'],
        load: fn,
        when: false,
      });
      return <div data-testid="out">{r.empty ? 'empty' : String(r.value)}</div>;
    }

    render(
      <ResourceProvider>
        <Disabled />
      </ResourceProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('out').textContent).toBe('empty');
    });
    expect(fn).not.toHaveBeenCalled();
  });

  it('keeps a stable default store across provider rerenders', () => {
    const stores: ReturnType<typeof useStore>[] = [];

    function Capture() {
      stores.push(useStore());
      return null;
    }

    const { rerender } = render(
      <ResourceProvider>
        <Capture />
      </ResourceProvider>,
    );
    rerender(
      <ResourceProvider>
        <Capture />
      </ResourceProvider>,
    );

    expect(stores.length).toBe(2);
    expect(stores[0]).toBe(stores[1]);
  });

  it('does not refetch when an inline load function identity changes', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('down'));

    function InlineLoad({ tick }: { tick: number }) {
      useResource({
        id: ['inline-load'],
        load: () => fn(tick),
        retries: false,
      });
      return <div data-testid="tick">{tick}</div>;
    }

    const { rerender } = render(
      <ResourceProvider>
        <InlineLoad tick={0} />
      </ResourceProvider>,
    );

    await waitFor(() => {
      expect(fn).toHaveBeenCalledTimes(1);
    });

    rerender(
      <ResourceProvider>
        <InlineLoad tick={1} />
      </ResourceProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('tick').textContent).toBe('1');
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('stops refreshEvery polling after repeated failures', async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValue(new Error('down'));

    function Polling() {
      useResource({
        id: ['poll-stop'],
        load: fn,
        refreshEvery: 100,
        retries: false,
      });
      return null;
    }

    render(
      <ResourceProvider>
        <Polling />
      </ResourceProvider>,
    );

    await vi.runAllTimersAsync();
    // 1 initial ensure + 5 scheduler ticks (maxFailures)
    expect(fn.mock.calls.length).toBeLessThanOrEqual(6);

    fn.mockClear();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fn).toHaveBeenCalledTimes(0);

    vi.useRealTimers();
  });

  it('resets poll interval after a successful reload', async () => {
    vi.useFakeTimers();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('ok');

    function Polling() {
      useResource({
        id: ['poll-recover'],
        load: fn,
        refreshEvery: 100,
        retries: false,
      });
      return null;
    }

    render(
      <ResourceProvider>
        <Polling />
      </ResourceProvider>,
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(100);
    expect(fn).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(100);
    expect(fn).toHaveBeenCalledTimes(3);

    vi.useRealTimers();
  });

  it('reload forces a refetch even when fresh', async () => {
    const fn = vi.fn()
      .mockResolvedValueOnce('a')
      .mockResolvedValueOnce('b');

    function Harness() {
      const r = useResource({
        id: ['force-reload'],
        load: fn,
        freshFor: 60_000,
      });
      return (
        <button type="button" onClick={() => void r.reload()}>
          {r.value ?? 'loading'}
        </button>
      );
    }

    render(
      <ResourceProvider>
        <Harness />
      </ResourceProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole('button').textContent).toBe('a');
    });
    expect(fn).toHaveBeenCalledTimes(1);

    screen.getByRole('button').click();
    await waitFor(() => {
      expect(screen.getByRole('button').textContent).toBe('b');
    });
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
