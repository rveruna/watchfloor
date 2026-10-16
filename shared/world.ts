import type { About, Ack, Device, EventsResponse, MonitorEvent, ServerMessage, User } from './protocol.js';
import { authenticate } from './accounts.js';
import { createSimulator, DEVICES, type Simulator } from './simulator.js';

/**
 * Everything a deployment knows: its devices, its events, who may sign in. The mock server wraps this in HTTP and a
 * websocket; the browser demo wraps the same thing in plain function calls. Because both run this one class, the demo
 * cannot behave differently from the server in any way that matters.
 */

export const VERSION = '0.1.0';
export const FEATURES = ['alarms', 'device-health', 'acknowledge'] as const;
const MAX_STORED = 10_000;

export interface WorldOptions {
  seed?: number;
  /** The time of the first event, in milliseconds. */
  start: number;
  /** How many events already exist when it starts, so a new visitor sees history. */
  preload?: number;
  now?: () => number;
}

export type Listener = (message: ServerMessage) => void;

export class World {
  private readonly simulator: Simulator;
  private readonly now: () => number;
  private readonly listeners = new Set<Listener>();
  private readonly deviceList: Device[] = DEVICES.map((d) => ({ ...d }));
  private events: MonitorEvent[] = [];

  constructor({ seed = 7, start, preload = 40, now = Date.now }: WorldOptions) {
    this.simulator = createSimulator({ seed, start });
    this.now = now;
    for (const event of this.simulator.take(preload)) this.store(event);
  }

  about(): About {
    return { version: VERSION, product: 'monitor', features: [...FEATURES] };
  }

  /** The user for these credentials, or null. */
  authenticate(email: string, password: string): User | null {
    return authenticate(email, password);
  }

  devices(): Device[] {
    return this.deviceList.map((d) => ({ ...d }));
  }

  get lastSeq(): number {
    return this.events.at(-1)?.seq ?? 0;
  }

  /** Events with a sequence number above `sinceSeq`, oldest first, at most `limit` of them. */
  eventsSince(sinceSeq: number, limit: number): EventsResponse {
    const after = this.events.filter((e) => e.seq > sinceSeq);
    const page = after.slice(0, limit);
    return { events: page.map((e) => ({ ...e })), lastSeq: this.lastSeq, more: after.length > page.length };
  }

  /** The newest `limit` events, oldest first. */
  latest(limit: number): EventsResponse {
    const page = this.events.slice(-limit);
    return { events: page.map((e) => ({ ...e })), lastSeq: this.lastSeq, more: false };
  }

  /**
   * Acknowledges an event. Does nothing, and says so, if it was already acknowledged, so a double click or a retry
   * cannot overwrite who got there first.
   */
  acknowledge(
    eventId: string,
    by: User,
  ):
    | { status: 'ok'; ack: Ack }
    | { status: 'already'; ack: Ack }
    | { status: 'missing' }
    | { status: 'forbidden' } {
    if (by.role !== 'operator') return { status: 'forbidden' };
    const event = this.events.find((e) => e.id === eventId);
    if (!event) return { status: 'missing' };
    if (event.ack) return { status: 'already', ack: event.ack };
    const ack: Ack = { by: by.name, at: new Date(this.now()).toISOString() };
    event.ack = ack;
    this.broadcast({ type: 'ack', eventId, ack });
    return { status: 'ok', ack };
  }

  /** Makes the next event happen, tells everyone listening, and returns it. */
  tick(): MonitorEvent {
    const event = this.simulator.next();
    this.store(event);
    this.broadcast({ type: 'event', event: { ...event } });
    return event;
  }

  /** The milliseconds until the next event should happen. */
  nextGap(): number {
    return this.simulator.gap();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private store(event: MonitorEvent): void {
    this.events.push(event);
    if (this.events.length > MAX_STORED) this.events = this.events.slice(-MAX_STORED);
    const device = this.deviceList.find((d) => d.id === event.deviceId);
    if (!device) return;
    const status = event.kind === 'went_offline' ? 'offline' : event.kind === 'came_online' ? 'online' : null;
    if (status && device.status !== status) {
      device.status = status;
      this.broadcast({ type: 'device', device: { ...device } });
    }
  }

  private broadcast(message: ServerMessage): void {
    for (const listener of this.listeners) listener(message);
  }
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Keeps events happening, one after another with the world's own gaps between them. Returns a function that stops it. */
export function startTicker(world: World, timers: Timers = globalThis): () => void {
  let handle: unknown;
  let running = true;
  const schedule = () => {
    handle = timers.setTimeout(() => {
      if (!running) return;
      world.tick();
      schedule();
    }, world.nextGap());
  };
  schedule();
  return () => {
    running = false;
    timers.clearTimeout(handle);
  };
}
