import { vi } from 'vitest';
import type { Ack, Device, EventsResponse, MonitorEvent, ServerMessage } from '@shared/protocol';
import { applyAck, applyEvent, emptyLog, mergeEvents, type EventLog, type Gap } from '@/domain/eventLog';
import type { Api } from '@/net/api';
import type { Socket, SocketHandlers } from '@/net/socket';
import type { EventSink } from '@/net/sync';

export class FakeSocket implements Socket {
  sent: unknown[] = [];
  closed = false;
  constructor(readonly handlers: SocketHandlers) {}
  send(text: string) {
    this.sent.push(JSON.parse(text));
  }
  close() {
    this.closed = true;
  }
  // what the server or the network does
  open() {
    this.handlers.open();
  }
  receive(message: ServerMessage | string) {
    this.handlers.message(typeof message === 'string' ? message : JSON.stringify(message));
  }
  hello(lastSeq = 0, heartbeatMs = 1000) {
    this.receive({ type: 'hello', serverTime: 't', lastSeq, heartbeatMs });
  }
  drop(clean = false) {
    this.handlers.close({ clean, code: clean ? 1000 : 1006 });
  }
}

export function fakeSockets() {
  const sockets: FakeSocket[] = [];
  return {
    sockets,
    factory: (handlers: SocketHandlers) => {
      const socket = new FakeSocket(handlers);
      sockets.push(socket);
      return socket;
    },
    get last(): FakeSocket {
      return sockets[sockets.length - 1]!;
    },
  };
}

export class TestSink implements EventSink {
  log: EventLog = emptyLog();
  acks: Array<[string, Ack]> = [];
  devices: Device[] = [];
  highestSeq = () => this.log.highestSeq;
  contiguousSeq = () => this.log.contiguousSeq;
  applyLive(event: MonitorEvent): Gap | null {
    const result = applyEvent(this.log, event);
    this.log = result.log;
    return result.gap;
  }
  merge(events: MonitorEvent[]): Gap | null {
    const result = mergeEvents(this.log, events);
    this.log = result.log;
    return result.gap;
  }
  resets = 0;
  reset() {
    this.resets++;
    this.log = emptyLog();
  }
  acknowledged(eventId: string, ack: Ack) {
    this.acks.push([eventId, ack]);
    this.log = applyAck(this.log, eventId, ack);
  }
  deviceChanged(device: Device) {
    this.devices.push(device);
  }
  get seqs(): number[] {
    return this.log.ids.map((id) => this.log.byId[id]!.seq);
  }
}

/** An API whose answers a test supplies. */
export function fakeApi(events: MonitorEvent[] = []) {
  const store = [...events];
  const calls: string[] = [];
  const api: Api = {
    about: vi.fn(),
    login: vi.fn(),
    me: vi.fn(),
    logout: vi.fn(),
    devices: vi.fn(),
    acknowledge: vi.fn(),
    latest: vi.fn(async (limit: number): Promise<EventsResponse> => {
      calls.push(`latest ${limit}`);
      return { events: store.slice(-limit), lastSeq: store.at(-1)?.seq ?? 0, more: false };
    }),
    events: vi.fn(async (since: number, limit: number): Promise<EventsResponse> => {
      calls.push(`events ${since} ${limit}`);
      const after = store.filter((e) => e.seq > since);
      return { events: after.slice(0, limit), lastSeq: store.at(-1)?.seq ?? 0, more: after.length > limit };
    }),
  };
  return { api, calls, store };
}
