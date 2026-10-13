import React, { Suspense } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import {
  ResourceProvider,
  useAction,
  useLiveResource,
  usePagedResource,
  useResource,
  useStore,
  useSuspenseResource,
} from '../../src/react/index.js';
import type { ResourceStore } from '../../src/resource/resource-store.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('useLiveResource', () => {
  it('subscribes once even with inline ids and merges frames', async () => {
    const subscribe = vi.fn((onEvent: (raw: string) => void) => {
      onEvent('{"n":1}');
    });

    function Live({ tick }: { tick: number }) {
      const r = useLiveResource<{ n: number }>({
        id: ['live', tick > 100 ? 'other' : 'same'],
        load: async () => ({ n: 0 }),
        subscribe,
        merge: (prev, next) => ({ n: (prev?.n ?? 0) + next.n }),
      });
      return <div data-testid="n">{r.value?.n ?? 'none'}</div>;
    }

    const { rerender } = render(
      <ResourceProvider>
        <Live tick={0} />
      </ResourceProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('n').textContent).toBe('1'));
    rerender(
      <ResourceProvider>
        <Live tick={1} />
      </ResourceProvider>,
    );
    rerender(
      <ResourceProvider>
        <Live tick={2} />
      </ResourceProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('n').textContent).toBe('1'));
    expect(subscribe).toHaveBeenCalledTimes(1);
  });
});

describe('useResource', () => {
  it('reloads after the store drops the entry', async () => {
    const fn = vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second');
    let store!: ResourceStore;

    function Harness() {
      store = useStore();
      const r = useResource({ id: ['dropme'], load: fn, freshFor: 60_000 });
      return <div data-testid="v">{r.value ?? 'empty'}</div>;
    }

    render(
      <ResourceProvider>
        <Harness />
      </ResourceProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('v').textContent).toBe('first'));
    act(() => store.drop());
    await waitFor(() => expect(screen.getByTestId('v').textContent).toBe('second'));
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('keepPrevious shows the old value while a new id loads', async () => {
    const gate: Record<string, () => void> = {};
    const load = (key: string) => () =>
      new Promise<string>((resolve) => {
        gate[key] = () => resolve(`value-${key}`);
      });

    function Harness({ k }: { k: string }) {
      const r = useResource({ id: ['kp', k], load: load(k), keepPrevious: true });
      return (
        <div data-testid="v">
          {r.value ?? 'empty'}|{String(r.placeholder)}
        </div>
      );
    }

    const { rerender } = render(
      <ResourceProvider>
        <Harness k="a" />
      </ResourceProvider>,
    );
    await waitFor(() => expect(gate.a).toBeDefined());
    act(() => gate.a!());
    await waitFor(() => expect(screen.getByTestId('v').textContent).toBe('value-a|false'));

    rerender(
      <ResourceProvider>
        <Harness k="b" />
      </ResourceProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('v').textContent).toBe('value-a|true'));
    await waitFor(() => expect(gate.b).toBeDefined());
    act(() => gate.b!());
    await waitFor(() => expect(screen.getByTestId('v').textContent).toBe('value-b|false'));
  });

  it('keeps reload identity stable across value changes', async () => {
    const reloads: unknown[] = [];
    function Harness() {
      const r = useResource({ id: ['stable'], load: async () => Math.random() });
      reloads.push(r.reload);
      return <div data-testid="v">{r.value === undefined ? 'empty' : 'ready'}</div>;
    }
    render(
      <ResourceProvider>
        <Harness />
      </ResourceProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('v').textContent).toBe('ready'));
    expect(new Set(reloads).size).toBe(1);
  });
});

describe('useAction', () => {
  it('applies optimistic updates and rolls back on failure', async () => {
    let store!: ResourceStore;
    let submit!: (v: string) => Promise<unknown>;
    function Harness() {
      store = useStore();
      const r = useResource({ id: ['count'], load: async () => 1 });
      const action = useAction<void, string>({
        run: async (input) => {
          if (input === 'fail') throw new Error('nope');
        },
        optimistic: () => [[['count'], (prev) => ((prev as number) ?? 0) + 10]],
      });
      submit = action.submitAsync;
      return (
        <div data-testid="v">
          {r.value}|{String(action.failed)}|{action.error?.message ?? ''}
        </div>
      );
    }
    render(
      <ResourceProvider>
        <Harness />
      </ResourceProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('v').textContent).toBe('1|false|'));

    await act(async () => {
      await submit('fail').catch(() => undefined);
    });
    expect(store.peek(['count'])).toBe(1);
    await waitFor(() => expect(screen.getByTestId('v').textContent).toBe('1|true|nope'));

    await act(async () => {
      await submit('ok');
    });
    expect(store.peek(['count'])).toBe(11);
  });
});

describe('useSuspenseResource', () => {
  it('suspends until loaded', async () => {
    function Inner() {
      const r = useSuspenseResource({ id: ['sus'], load: async () => 'done' });
      return <div data-testid="v">{r.value}</div>;
    }
    render(
      <ResourceProvider>
        <Suspense fallback={<div data-testid="v">loading</div>}>
          <Inner />
        </Suspense>
      </ResourceProvider>,
    );
    expect(screen.getByTestId('v').textContent).toBe('loading');
    await waitFor(() => expect(screen.getByTestId('v').textContent).toBe('done'));
  });
});

describe('usePagedResource', () => {
  it('loads pages on demand and reloads all known pages', async () => {
    const loadPage = vi.fn(async (cursor: number | undefined) => ({
      items: [cursor ?? 0],
      next: (cursor ?? 0) < 2 ? (cursor ?? 0) + 1 : null,
    }));
    let api!: ReturnType<typeof usePagedResource<{ items: number[]; next: number | null }, number>>;

    function Harness() {
      api = usePagedResource<{ items: number[]; next: number | null }, number>({
        id: ['paged'],
        loadPage,
        nextCursor: (page) => page.next,
      });
      return <div data-testid="v">{api.pages.flatMap((p) => p.items).join(',')}</div>;
    }
    render(
      <ResourceProvider>
        <Harness />
      </ResourceProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('v').textContent).toBe('0'));
    expect(api.hasMore).toBe(true);

    await act(async () => {
      await api.loadMore();
    });
    await waitFor(() => expect(screen.getByTestId('v').textContent).toBe('0,1'));
    await act(async () => {
      await api.loadMore();
    });
    await waitFor(() => expect(screen.getByTestId('v').textContent).toBe('0,1,2'));
    expect(api.hasMore).toBe(false);

    loadPage.mockClear();
    await act(async () => {
      await api.reload();
    });
    expect(loadPage.mock.calls.map((c) => c[0])).toEqual([undefined, 1, 2]);
  });
});
