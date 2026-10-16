import { parseServerMessage, type Ack, type Device, type MonitorEvent } from '@shared/protocol';
import type { Gap } from '@/domain/eventLog';
import {
  transition,
  type ConnectionEffect,
  type ConnectionEvent,
  type ConnectionState,
} from '@/domain/connection';
import { silentLogger, type Logger } from '@/telemetry/logger';
import { ApiError, type Api } from './api';
import type { Socket, SocketFactory } from './socket';

/** Where the engine puts what it learns. The store implements this; tests use a small fake. */
export interface EventSink {
  highestSeq(): number;
  contiguousSeq(): number;
  /** One event from the stream. Returns the hole it revealed, if any. */
  applyLive(event: MonitorEvent): Gap | null;
  /** A page of events from a fetch. Returns any hole still left. */
  merge(events: MonitorEvent[]): Gap | null;
  /** The server's numbering started again from the beginning, so everything held is from another run. Forget it. */
  reset(): void;
  acknowledged(eventId: string, ack: Ack): void;
  deviceChanged(device: Device): void;
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface SyncOptions {
  api: Api;
  socketFactory: SocketFactory;
  sink: EventSink;
  onState?: (state: ConnectionState) => void;
  /** The server said the session is over. The engine stops; the app should send the person to sign in. */
  onUnauthorized?: () => void;
  logger?: Logger;
  now?: () => number;
  random?: () => number;
  timers?: Timers;
  /** How many of the newest events to load the first time. */
  snapshotSize?: number;
  /** How many events to ask for in one request when catching up. */
  pageSize?: number;
  /** How many heartbeats of silence mean the connection is dead. */
  silenceFactor?: number;
}

const MAX_PAGES = 100;
/** Copies of a server can disagree by an event or two about what has happened yet. Further behind than this means it started over. */
const RESET_MARGIN = 20;
const DEFAULT_HEARTBEAT_MS = 10_000;

const realTimers: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Keeps the app in step with a deployment. It opens the stream, loads what was missed over REST, asks for the live feed
 * from exactly where that left off, fills any hole it spots in the numbering, and, if the connection drops or goes
 * quiet, waits a little longer each time before trying again. All the decisions are in `transition`; this is only the
 * part that sets timers and opens sockets.
 */
export class SyncEngine {
  state: ConnectionState = { status: 'idle' };
  private socket: Socket | null = null;
  /** Which socket is current. Late news from an old one is ignored. */
  private generation = 0;
  private retryTimer: unknown = null;
  private watchdog: unknown = null;
  private heartbeatMs = DEFAULT_HEARTBEAT_MS;
  private backfilling = false;
  private backfillAgain: Gap | null = null;

  private readonly api: Api;
  private readonly socketFactory: SocketFactory;
  private readonly sink: EventSink;
  private readonly logger: Logger;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly timers: Timers;
  private readonly snapshotSize: number;
  private readonly pageSize: number;
  private readonly silenceFactor: number;
  private readonly onState: (state: ConnectionState) => void;
  private readonly onUnauthorized: () => void;

  constructor(options: SyncOptions) {
    this.api = options.api;
    this.socketFactory = options.socketFactory;
    this.sink = options.sink;
    this.logger = options.logger ?? silentLogger;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.timers = options.timers ?? realTimers;
    this.snapshotSize = options.snapshotSize ?? 200;
    this.pageSize = options.pageSize ?? 500;
    this.silenceFactor = options.silenceFactor ?? 2.5;
    this.onState = options.onState ?? (() => {});
    this.onUnauthorized = options.onUnauthorized ?? (() => {});
  }

  start(): void {
    this.dispatch({ type: 'start' });
  }

  stop(): void {
    this.dispatch({ type: 'stop' });
  }

  /** Cuts the connection as if the network had dropped, so the recovery can be watched. */
  sever(): void {
    this.logger.warn('connection cut on purpose');
    this.socket?.close();
  }

  private dispatch(event: ConnectionEvent): void {
    const before = this.state;
    const step = transition(this.state, event, this.random);
    this.state = step.state;
    if (step.state !== before) {
      this.logger.info(
        `connection ${before.status} → ${step.state.status}`,
        'attempt' in step.state ? { attempt: step.state.attempt } : undefined,
      );
      this.onState(step.state);
    }
    for (const effect of step.effects) this.run(effect);
  }

  private run(effect: ConnectionEffect): void {
    switch (effect.type) {
      case 'connect':
        this.openSocket();
        return;
      case 'wait':
        this.timers.clearTimeout(this.retryTimer);
        this.retryTimer = this.timers.setTimeout(() => this.dispatch({ type: 'retry-due' }), effect.ms);
        return;
      case 'close-socket':
        this.discardSocket();
        return;
    }
  }

  private discardSocket(): void {
    this.generation++;
    this.timers.clearTimeout(this.watchdog);
    this.timers.clearTimeout(this.retryTimer);
    const socket = this.socket;
    this.socket = null;
    socket?.close();
  }

  private openSocket(): void {
    const generation = ++this.generation;
    this.heartbeatMs = DEFAULT_HEARTBEAT_MS;
    this.armWatchdog(generation);
    this.socket = this.socketFactory({
      open: () => {
        if (generation !== this.generation) return;
        this.dispatch({ type: 'opened', now: this.now() });
      },
      message: (text) => {
        if (generation !== this.generation) return;
        this.armWatchdog(generation);
        this.handle(text, generation);
      },
      close: ({ clean, code }) => {
        if (generation !== this.generation) return;
        this.timers.clearTimeout(this.watchdog);
        this.logger.warn('connection closed', { clean, code });
        this.socket = null;
        this.dispatch({ type: 'closed', now: this.now() });
      },
    });
  }

  /** If nothing is heard for a few heartbeats, the connection is dead whatever the browser thinks. */
  private armWatchdog(generation: number): void {
    this.timers.clearTimeout(this.watchdog);
    this.watchdog = this.timers.setTimeout(() => {
      if (generation !== this.generation) return;
      this.logger.warn('nothing heard from the server', { heartbeatMs: this.heartbeatMs });
      this.dispatch({ type: 'silent', now: this.now() });
    }, this.heartbeatMs * this.silenceFactor);
  }

  private handle(text: string, generation: number): void {
    const parsed = parseServerMessage(text);
    if (!parsed.ok) {
      this.logger.warn('ignored a message it could not read', { reason: parsed.reason });
      return;
    }
    const message = parsed.message;
    switch (message.type) {
      case 'hello':
        this.heartbeatMs = message.heartbeatMs;
        this.armWatchdog(generation);
        if (message.lastSeq + RESET_MARGIN < this.sink.highestSeq()) {
          this.logger.warn(
            'the server is further behind than anything seen, so its numbering started again',
            {
              serverLastSeq: message.lastSeq,
              held: this.sink.highestSeq(),
            },
          );
          this.sink.reset();
        }
        void this.catchUp(generation);
        return;
      case 'ping':
        this.socket?.send(JSON.stringify({ type: 'pong', at: message.at }));
        return;
      case 'event': {
        const gap = this.sink.applyLive(message.event);
        if (gap) {
          this.logger.warn('missed events, fetching them', { from: gap.from, to: gap.to });
          void this.backfill(gap, generation);
        }
        return;
      }
      case 'ack':
        this.sink.acknowledged(message.eventId, message.ack);
        return;
      case 'device':
        this.sink.deviceChanged(message.device);
        return;
    }
  }

  /** Loads what was missed while away, then asks the stream for everything after that. */
  private async catchUp(generation: number): Promise<void> {
    try {
      if (this.sink.highestSeq() === 0) {
        const page = await this.api.latest(this.snapshotSize);
        if (generation !== this.generation) return;
        this.sink.merge(page.events);
      } else {
        await this.fillFrom(this.sink.contiguousSeq(), Infinity, generation);
      }
      if (generation !== this.generation) return;
      this.socket?.send(JSON.stringify({ type: 'subscribe', sinceSeq: this.sink.highestSeq() }));
    } catch (error) {
      this.failed(error, generation);
    }
  }

  private async backfill(gap: Gap, generation: number): Promise<void> {
    if (this.backfilling) {
      // one fetch at a time; remember the widest hole and do it again afterwards
      this.backfillAgain = this.backfillAgain
        ? { from: Math.min(this.backfillAgain.from, gap.from), to: Math.max(this.backfillAgain.to, gap.to) }
        : gap;
      return;
    }
    this.backfilling = true;
    try {
      await this.fillFrom(gap.from - 1, gap.to, generation);
    } catch (error) {
      this.failed(error, generation);
    } finally {
      this.backfilling = false;
      const again = this.backfillAgain;
      this.backfillAgain = null;
      if (again && generation === this.generation) void this.backfill(again, generation);
    }
  }

  /** Fetches events after `since` page by page until `until` is covered or the server has no more. */
  private async fillFrom(since: number, until: number, generation: number): Promise<void> {
    let cursor = since;
    for (let pages = 0; pages < MAX_PAGES; pages++) {
      const page = await this.api.events(cursor, this.pageSize);
      if (generation !== this.generation) return;
      const hole = this.sink.merge(page.events);
      const last = page.events.at(-1)?.seq ?? cursor;
      if (!page.more || last >= until) {
        if (hole && until === Infinity)
          this.logger.warn('still a hole after catching up', { from: hole.from, to: hole.to });
        return;
      }
      cursor = last;
    }
    this.logger.warn('gave up catching up after too many pages');
  }

  private failed(error: unknown, generation: number): void {
    if (generation !== this.generation) return;
    if (error instanceof ApiError && error.kind === 'unauthorized') {
      this.logger.error('session ended');
      this.stop();
      this.onUnauthorized();
      return;
    }
    this.logger.error('could not catch up, reconnecting', {
      reason: error instanceof Error ? error.message : String(error),
    });
    this.socket?.close();
  }
}
