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
});
