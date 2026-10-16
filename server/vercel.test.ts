// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { cacheAckStore, createVercelServer, weekStart, type CacheLike } from './vercel';

describe('weekStart', () => {
  it('is midnight on the Monday of that week, in UTC', () => {
    // Friday 16 October 2026, mid-afternoon
    expect(new Date(weekStart(Date.UTC(2026, 9, 16, 15, 30))).toISOString()).toBe('2026-10-12T00:00:00.000Z');
  });

  it('is the same moment all week, and moves on at midnight on Sunday night', () => {
    const monday = Date.UTC(2026, 9, 12);
    expect(weekStart(monday)).toBe(monday);
    expect(weekStart(monday + 7 * 86_400_000 - 1)).toBe(monday);
    expect(weekStart(monday + 7 * 86_400_000)).toBe(monday + 7 * 86_400_000);
  });

  it('treats Sunday as the end of the week, not the start', () => {
    expect(new Date(weekStart(Date.UTC(2026, 9, 18, 12))).toISOString()).toBe('2026-10-12T00:00:00.000Z');
  });
});

function fakeCache() {
  const held = new Map<string, unknown>();
  const sets: Array<{ key: string; ttl?: number }> = [];
  const cache: CacheLike = {
    get: async (key) => held.get(key),
    set: async (key, value, options) => {
      held.set(key, value);
      sets.push({ key, ...(options?.ttl ? { ttl: options.ttl } : {}) });
    },
  };
  return { cache, held, sets };
}

describe('the acknowledgement store on the cache', () => {
  it('records the first acknowledgement under one key, with a time limit', async () => {
    const { cache, sets } = fakeCache();
    const store = cacheAckStore(cache, 'acks:1');
    expect(await store.claim('evt-1', { by: 'A', at: 't' })).toEqual({
      won: true,
      ack: { by: 'A', at: 't' },
    });
    expect(sets).toEqual([{ key: 'acks:1', ttl: 8 * 86_400 }]);
  });

  it('keeps the first one when a second arrives', async () => {
    const { cache, sets } = fakeCache();
    const store = cacheAckStore(cache, 'acks:1');
    await store.claim('evt-1', { by: 'A', at: 't1' });
    expect(await store.claim('evt-1', { by: 'B', at: 't2' })).toEqual({
      won: false,
      ack: { by: 'A', at: 't1' },
    });
    expect(sets).toHaveLength(1);
  });

  it('reads back only the ones asked for', async () => {
    const { cache } = fakeCache();
    const store = cacheAckStore(cache, 'acks:1');
    await store.claim('evt-1', { by: 'A', at: 't' });
    await store.claim('evt-2', { by: 'B', at: 't' });
    expect(await store.read(['evt-2', 'evt-3'])).toEqual({ 'evt-2': { by: 'B', at: 't' } });
  });

  it('reads nothing from an empty or damaged entry', async () => {
    const { cache, held } = fakeCache();
    const store = cacheAckStore(cache, 'acks:1');
    expect(await store.read(['evt-1'])).toEqual({});
    held.set('acks:1', 'garbage');
    expect(await store.read(['evt-1'])).toEqual({});
    expect(await store.claim('evt-1', { by: 'A', at: 't' })).toMatchObject({ won: true });
  });

  it('keeps only the newest 500, so the entry cannot grow without limit', async () => {
    const { cache, held } = fakeCache();
    const store = cacheAckStore(cache, 'acks:1');
    for (let i = 1; i <= 520; i++) await store.claim(`evt-${i}`, { by: 'A', at: 't' });
    const stored = held.get('acks:1') as Record<string, unknown>;
    expect(Object.keys(stored)).toHaveLength(500);
    expect(stored['evt-1']).toBeUndefined();
    expect(stored['evt-520']).toBeDefined();
  });
});

describe('starting up', () => {
  it('refuses to start without a secret for the sign-in cookies', () => {
    expect(() => createVercelServer({})).toThrow('SESSION_SECRET is not set');
  });

  it('starts with one, using the Secure flag only on Vercel itself', async () => {
    for (const [env, secure] of [
      [{ SESSION_SECRET: 's' }, false],
      [{ SESSION_SECRET: 's', VERCEL: '1' }, true],
    ] as const) {
      const running = createVercelServer(env);
      const port = await running.listen(0);
      const response = await fetch(`http://localhost:${port}/api/v1/dologin`, {
        method: 'POST',
        body: JSON.stringify({ email: 'viewer@example.com', password: 'viewer' }),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('set-cookie')?.includes('Secure')).toBe(secure);
      await running.close();
    }
  });
});
