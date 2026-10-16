import { afterEach, describe, expect, it } from 'vitest';
import { createDemoServices, createServerServices, services, setServices } from './services';

afterEach(() => setServices(null));

describe('services', () => {
  it('refuses to be used before it has been set up, saying why', () => {
    expect(() => services()).toThrow(/has not been given its services/);
  });

  it('hands back what it was given', () => {
    const s = createDemoServices({ ticker: false });
    setServices(s);
    expect(services()).toBe(s);
    expect(s.mode).toBe('demo');
  });

  it('builds a server version that talks to the same host', () => {
    const s = createServerServices({ protocol: 'https:', host: 'example.dev' });
    expect(s.mode).toBe('server');
  });

  it('builds a server version for the page it is in by default', () => {
    expect(createServerServices().mode).toBe('server');
  });

  it('makes events happen on their own unless told not to', async () => {
    const { vi } = await import('vitest');
    vi.useFakeTimers();
    const s = createDemoServices();
    const before = s.world.lastSeq;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(s.world.lastSeq).toBeGreaterThan(before);
    vi.useRealTimers();
  });
});
