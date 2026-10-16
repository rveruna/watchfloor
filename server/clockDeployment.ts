import type { Ack, Device, EventsResponse, MonitorEvent, ServerMessage } from '../shared/protocol.js';
import { createSimulator, DEVICES, type Simulator } from '../shared/simulator.js';
import { authenticate } from '../shared/accounts.js';
import { FEATURES, VERSION } from '../shared/world.js';
import type { AckOutcome, Deployment } from './deployment.js';

/**
 * A deployment with no memory of its own, for places where several copies run side by side and none can see another's
 * memory. Events are a pure function of a seed and the clock, so every copy makes exactly the same ones; what a person
 * acknowledges is kept in a store that all copies share.
 */

export interface AckStore {
  /** The acknowledgements held for these events. */
  read(ids: readonly string[]): Promise<Record<string, Ack>>;
  /** Records an acknowledgement unless there already is one, and says whose it is. */
  claim(id: string, ack: Ack): Promise<{ won: boolean; ack: Ack }>;
}

export function memoryAckStore(): AckStore {
  const held = new Map<string, Ack>();
  return {
    async read(ids) {
      return Object.fromEntries(ids.flatMap((id) => (held.has(id) ? [[id, held.get(id)!]] : [])));
    },
    async claim(id, ack) {
      const existing = held.get(id);
      if (existing) return { won: false, ack: existing };
      held.set(id, ack);
      return { won: true, ack };
    },
  };
}

export interface ClockDeploymentOptions {
  seed?: number;
  /** When event number 1 happened. Everything after follows from this and the seed, so every copy must use the same one. */
  epoch: number;
  now?: () => number;
  store: AckStore;
  /** How often a followed stream looks for new events and acknowledgements. */
  pollMs?: number;
  /** A ceiling on events held, so a long-running copy cannot grow without limit. */
  maxEvents?: number;
}

const RECENT = 200;

export function createClockDeployment({
  seed = 7,
  epoch,
  now = Date.now,
  store,
  pollMs = 1_000,
  maxEvents = 300_000,
}: ClockDeploymentOptions): Deployment {
  const simulator: Simulator = createSimulator({ seed, start: epoch });
  const events: MonitorEvent[] = [];
  const status = new Map<string, Device['status']>(DEVICES.map((d) => [d.id, d.status]));
  let waiting: MonitorEvent | null = null;

  /** Makes every event that has happened by now. Sequence numbers run 1, 2, 3, so event n is at index n - 1. */
  function advance(): void {
    for (;;) {
      if (events.length >= maxEvents) return;
      const next = waiting ?? simulator.next();
      if (Date.parse(next.at) > now()) {
        waiting = next;
        return;
      }
      waiting = null;
      events.push(next);
      if (next.kind === 'went_offline') status.set(next.deviceId, 'offline');
      if (next.kind === 'came_online') status.set(next.deviceId, 'online');
    }
  }

  const deviceNow = (id: string): Device => {
    const base = DEVICES.find((d) => d.id === id)!;
    return { ...base, status: status.get(id) ?? base.status };
  };

  async function withAcks(list: MonitorEvent[]): Promise<MonitorEvent[]> {
    const acks = await store.read(list.map((e) => e.id));
    return list.map((e) => (acks[e.id] ? { ...e, ack: acks[e.id]! } : { ...e }));
  }

  return {
    about: () => ({ version: VERSION, product: 'monitor', features: [...FEATURES] }),
    authenticate,
    async devices() {
      advance();
      return DEVICES.map((d) => deviceNow(d.id));
    },
    async lastSeq() {
      advance();
      return events.length;
    },
    async eventsSince(sinceSeq, limit): Promise<EventsResponse> {
      advance();
      const page = events.slice(sinceSeq, sinceSeq + limit);
      return { events: await withAcks(page), lastSeq: events.length, more: sinceSeq + limit < events.length };
    },
    async latest(limit): Promise<EventsResponse> {
      advance();
      return { events: await withAcks(events.slice(-limit)), lastSeq: events.length, more: false };
    },
    async acknowledge(eventId, by): Promise<AckOutcome> {
      if (by.role !== 'operator') return { status: 'forbidden' };
      advance();
      const seq = /^evt-(\d+)$/.exec(eventId)?.[1];
      if (!seq || Number(seq) < 1 || Number(seq) > events.length) return { status: 'missing' };
      const claimed = await store.claim(eventId, { by: by.name, at: new Date(now()).toISOString() });
      return { status: claimed.won ? 'ok' : 'already', ack: claimed.ack };
    },
    follow(sinceSeq, listener) {
      let sent = sinceSeq;
      let stopped = false;
      const known = new Set<string>();
      let busy = false;

      const send = (message: ServerMessage) => {
        if (!stopped) listener(message);
      };

      async function step(): Promise<void> {
        if (busy || stopped) return;
        busy = true;
        try {
          advance();
          if (sent < events.length) {
            for (const event of await withAcks(events.slice(sent))) {
              if (event.ack) known.add(event.id);
              send({ type: 'event', event });
              if (event.kind === 'went_offline' || event.kind === 'came_online') {
                // the device as it was after this event, not as it is now
                send({
                  type: 'device',
                  device: {
                    ...DEVICES.find((d) => d.id === event.deviceId)!,
                    status: event.kind === 'went_offline' ? 'offline' : 'online',
                  },
                });
              }
            }
            sent = events.length;
          }
          // another copy may have taken an acknowledgement, so look at the recent events again
          const recent = events.slice(-RECENT).filter((e) => !known.has(e.id));
          const acks = await store.read(recent.map((e) => e.id));
          for (const [id, ack] of Object.entries(acks)) {
            if (known.has(id)) continue;
            known.add(id);
            send({ type: 'ack', eventId: id, ack });
          }
        } finally {
          busy = false;
        }
      }

      void step();
      const timer = setInterval(() => void step(), pollMs);
      timer.unref?.();
      return () => {
        stopped = true;
        clearInterval(timer);
      };
    },
  };
}
