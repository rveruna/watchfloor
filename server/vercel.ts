import { getCache } from '@vercel/functions';
import type { Ack } from '../shared/protocol.js';
import { createClockDeployment, memoryAckStore, type AckStore } from './clockDeployment.js';
import { createDeploymentServer, type RunningServer } from './core.js';
import { signedSessions } from './sessions.js';

/**
 * The deployment as it runs on Vercel: several copies at once, none able to see another's memory. Events come from the
 * clock, sessions are signed cookies, and acknowledgements live in the Runtime Cache, which the copies in a region share.
 */

/** Midnight at the start of the Monday of the week containing `ms`, in UTC. Numbering restarts then, so it cannot grow without end. */
export function weekStart(ms: number): number {
  const day = new Date(ms);
  const midnight = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
  const sinceMonday = (day.getUTCDay() + 6) % 7;
  return midnight - sinceMonday * 86_400_000;
}

export interface CacheLike {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown, options?: { ttl?: number; name?: string }): Promise<void>;
}

const KEEP = 500;
const TTL_SECONDS = 8 * 86_400;

/**
 * Keeps every acknowledgement in one cache entry. Simple, and good enough for a demo, but two people acknowledging at the
 * very same moment can overwrite each other: the cache has no compare-and-set. A real deployment would use a database.
 */
export function cacheAckStore(cache: CacheLike, key: string): AckStore {
  const load = async (): Promise<Record<string, Ack>> => {
    const value = await cache.get(key);
    return value && typeof value === 'object' ? (value as Record<string, Ack>) : {};
  };
  return {
    async read(ids) {
      const all = await load();
      return Object.fromEntries(ids.flatMap((id) => (all[id] ? [[id, all[id]]] : [])));
    },
    async claim(id, ack) {
      const all = await load();
      if (all[id]) return { won: false, ack: all[id] };
      const entries = Object.entries({ ...all, [id]: ack });
      await cache.set(key, Object.fromEntries(entries.slice(-KEEP)), {
        ttl: TTL_SECONDS,
        name: 'acknowledgements',
      });
      return { won: true, ack };
    },
  };
}

export function createVercelServer(
  env: Record<string, string | undefined> = process.env,
  now: () => number = Date.now,
): RunningServer {
  const secret = env.SESSION_SECRET;
  // without a secret anyone could make a session, so refuse to start rather than pretend
  if (!secret) throw new Error('SESSION_SECRET is not set');
  const epoch = weekStart(now());
  let store: AckStore;
  try {
    store = cacheAckStore(getCache({ namespace: 'watchfloor' }), `acks:${epoch}`);
  } catch {
    // outside Vercel there is no shared cache; acknowledgements then live only in this process
    store = memoryAckStore();
  }
  return createDeploymentServer({
    deployment: createClockDeployment({ epoch, now, store }),
    sessions: signedSessions(secret, now),
    secureCookies: env.VERCEL === '1',
    heartbeatMs: 10_000,
  });
}
