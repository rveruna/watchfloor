import { describe, expect, it, vi } from 'vitest';

const observers = vi.hoisted(() => {
  const make = (name: string) =>
    vi.fn((cb: (m: { name: string; value: number; rating: string; extra: number }) => void) =>
      cb({ name, value: 12.5, rating: 'good', extra: 1 }),
    );
  return {
    onCLS: make('CLS'),
    onFCP: make('FCP'),
    onINP: make('INP'),
    onLCP: make('LCP'),
    onTTFB: make('TTFB'),
  };
});
vi.mock('web-vitals', () => observers);

import { observeVitals } from './vitals';

describe('observeVitals', () => {
  it('reports each measure as it is made, with just the name, value and rating', async () => {
    const report = vi.fn();
    await observeVitals(report);
    expect(report.mock.calls.map(([v]) => v.name).sort()).toEqual(['CLS', 'FCP', 'INP', 'LCP', 'TTFB']);
    expect(report).toHaveBeenCalledWith({ name: 'LCP', value: 12.5, rating: 'good' });
  });
});
