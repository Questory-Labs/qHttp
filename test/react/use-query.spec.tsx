import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import {
  QHttpQueryProvider,
  useQuery,
  useQueryCache,
  useQueryClient,
} from '../../src/react/index.js';

function TestQuery() {
  const q = useQuery({
    queryKey: ['hello'],
    queryFn: async () => 'world',
  });
  return <div data-testid="out">{q.isPending ? 'loading' : q.data}</div>;
}

describe('useQuery', () => {
  it('loads data through provider', async () => {
    render(
      <QHttpQueryProvider>
        <TestQuery />
      </QHttpQueryProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('out').textContent).toBe('world');
    });
  });

  it('respects enabled=false', async () => {
    const fn = vi.fn(async () => 'nope');

    function Disabled() {
      const q = useQuery({
        queryKey: ['disabled'],
        queryFn: fn,
        enabled: false,
      });
      return <div data-testid="out">{q.isPending ? 'loading' : String(q.data)}</div>;
    }

    render(
      <QHttpQueryProvider>
        <Disabled />
      </QHttpQueryProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('out').textContent).toBe('undefined');
    });
    expect(fn).not.toHaveBeenCalled();
  });

  it('keeps a stable default client across provider rerenders', () => {
    const caches: ReturnType<typeof useQueryCache>[] = [];

    function Capture() {
      caches.push(useQueryCache());
      return null;
    }

    const { rerender } = render(
      <QHttpQueryProvider>
        <Capture />
      </QHttpQueryProvider>,
    );
    rerender(
      <QHttpQueryProvider>
        <Capture />
      </QHttpQueryProvider>,
    );

    expect(caches.length).toBe(2);
    expect(caches[0]).toBe(caches[1]);
  });

  it('keeps a stable query client across rerenders', () => {
    const clients: ReturnType<typeof useQueryClient>[] = [];

    function Capture() {
      clients.push(useQueryClient());
      return null;
    }

    const { rerender } = render(
      <QHttpQueryProvider>
        <Capture />
      </QHttpQueryProvider>,
    );
    rerender(
      <QHttpQueryProvider>
        <Capture />
      </QHttpQueryProvider>,
    );

    expect(clients.length).toBe(2);
    expect(clients[0]).toBe(clients[1]);
  });
});
