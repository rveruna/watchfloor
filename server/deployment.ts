import type { About, Ack, Device, EventsResponse, ServerMessage, User } from '../shared/protocol.js';
import type { World } from '../shared/world.js';

export type AckOutcome =
  | { status: 'ok'; ack: Ack }
  | { status: 'already'; ack: Ack }
  | { status: 'missing' }
  | { status: 'forbidden' };

/**
 * Everything the server needs to know about a deployment, as questions that may take time to answer. The mock server
 * answers from one World in memory; the Vercel one derives answers from the clock and keeps acknowledgements in a store
 * shared between instances, because two instances cannot share memory.
 */
export interface Deployment {
  about(): About;
  authenticate(email: string, password: string): User | null;
  devices(): Promise<Device[]>;
  lastSeq(): Promise<number>;
  eventsSince(sinceSeq: number, limit: number): Promise<EventsResponse>;
  latest(limit: number): Promise<EventsResponse>;
  acknowledge(eventId: string, by: User): Promise<AckOutcome>;
  /**
   * Sends everything after `sinceSeq` to `listener`, then each new event, acknowledgement and device change as it
   * happens, until the returned function is called.
   */
  follow(sinceSeq: number, listener: (message: ServerMessage) => void): () => void;
}

/** One World in memory, as a deployment. */
export function worldDeployment(world: World): Deployment {
  return {
    about: () => world.about(),
    authenticate: (email, password) => world.authenticate(email, password),
    devices: async () => world.devices(),
    lastSeq: async () => world.lastSeq,
    eventsSince: async (sinceSeq, limit) => world.eventsSince(sinceSeq, limit),
    latest: async (limit) => world.latest(limit),
    acknowledge: async (eventId, by) => world.acknowledge(eventId, by),
    follow(sinceSeq, listener) {
      for (const event of world.eventsSince(sinceSeq, 10_000).events) listener({ type: 'event', event });
      return world.subscribe(listener);
    },
  };
}
