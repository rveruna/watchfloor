import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { event } from '@/test/factories';
import { fakeApi, fakeSockets, TestSink } from '@/test/syncHarness';
import { createLogger } from '@/telemetry/logger';
import { ApiError } from './api';
import { SyncEngine } from './sync';
import type { ConnectionState } from '@/domain/connection';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => event(from + i));
const settle = async () => {
  await vi.advanceTimersByTimeAsync(0);
};

function setup(history = range(1, 30), options: { pageSize?: number; snapshotSize?: number } = {}) {
  const sockets = fakeSockets();
  const { api, calls, store } = fakeApi(history);
  const sink = new TestSink();
  const states: ConnectionState[] = [];
  const logger = createLogger();
  const unauthorized = vi.fn();
  const engine = new SyncEngine({
    api,
    socketFactory: sockets.factory,
    sink,
    logger,
    onState: (s) => states.push(s),
    onUnauthorized: unauthorized,
    random: () => 0.999999,
    ...options,
  });
  return { engine, sockets, api, calls, store, sink, states, logger, unauthorized };
}

/** Opens the connection and lets the server say hello, as it does at the start of every connection. */
async function connect(t: ReturnType<typeof setup>, lastSeq = 30) {
  t.sockets.last.open();
  t.sockets.last.hello(lastSeq);
  await settle();
}

describe('connecting for the first time', () => {
  it('opens a socket, loads the newest events, then asks for the live stream from where they end', async () => {
    const t = setup(range(1, 300), { snapshotSize: 50 });
    t.engine.start();
    expect(t.engine.state).toEqual({ status: 'connecting', attempt: 0 });

    await connect(t, 300);

    expect(t.engine.state.status).toBe('open');
    expect(t.calls).toEqual(['latest 50']);
    expect(t.sink.seqs[0]).toBe(251);
    expect(t.sink.seqs.at(-1)).toBe(300);
    expect(t.sockets.last.sent).toEqual([{ type: 'subscribe', sinceSeq: 300 }]);
  });

  it('applies live events as they arrive', async () => {
    const t = setup();
    t.engine.start();
    await connect(t);
    t.sockets.last.receive({ type: 'event', event: event(31) });
    t.sockets.last.receive({ type: 'event', event: event(32) });
    expect(t.sink.seqs.slice(-2)).toEqual([31, 32]);
  });

  it('passes on acknowledgements and device changes', async () => {
    const t = setup();
    t.engine.start();
    await connect(t);
    t.sockets.last.receive({ type: 'ack', eventId: 'evt-5', ack: { by: 'Operator', at: 't' } });
    t.sockets.last.receive({
      type: 'device',
      device: { id: 'cam-yard', name: 'Yard camera', kind: 'camera', site: 'x', status: 'offline' },
    });
    expect(t.sink.acks).toEqual([['evt-5', { by: 'Operator', at: 't' }]]);
    expect(t.sink.devices[0]?.status).toBe('offline');
  });

  it('answers a ping with a pong', async () => {
    const t = setup();
    t.engine.start();
    await connect(t);
    t.sockets.last.receive({ type: 'ping', at: 'now' });
    expect(t.sockets.last.sent).toContainEqual({ type: 'pong', at: 'now' });
  });

  it('ignores a message it cannot read, and says so in the log', async () => {
    const t = setup();
    t.engine.start();
    await connect(t);
    t.sockets.last.receive('garbage');
    t.sockets.last.receive({ type: 'event', event: event(31) });
    expect(t.sink.seqs.at(-1)).toBe(31);
    expect(t.logger.entries().some((e) => e.message.includes('could not read'))).toBe(true);
  });
});

describe('missing events', () => {
  it('fetches the ones skipped over when the numbering jumps', async () => {
    const t = setup(range(1, 30));
    t.engine.start();
    await connect(t, 30);
    t.store.push(...range(31, 36));
    t.sockets.last.receive({ type: 'event', event: event(31) });
    t.sockets.last.receive({ type: 'event', event: event(36) });
    await settle();

    expect(t.calls).toContain('events 31 500');
    expect(t.sink.seqs.slice(-6)).toEqual([31, 32, 33, 34, 35, 36]);
    expect(t.sink.log.contiguousSeq).toBe(36);
  });

  it('pages through a large hole', async () => {
    const t = setup(range(1, 30), { pageSize: 20 });
    t.engine.start();
    await connect(t, 30);
    t.store.push(...range(31, 90));
    t.sockets.last.receive({ type: 'event', event: event(31) });
    t.sockets.last.receive({ type: 'event', event: event(90) });
    await settle();
    expect(t.calls.filter((c) => c.startsWith('events'))).toEqual([
      'events 31 20',
      'events 51 20',
      'events 71 20',
    ]);
    expect(t.sink.log.contiguousSeq).toBe(90);
  });

  it('stops asking as soon as the hole is covered, even if the server has more', async () => {
    const t = setup(range(1, 30), { pageSize: 10 });
    t.engine.start();
    await connect(t, 30);
    t.store.push(...range(31, 100));
    t.sockets.last.receive({ type: 'event', event: event(31) });
    t.sockets.last.receive({ type: 'event', event: event(42) });
    await settle();
    // the hole is 32 to 41, which is exactly one page after 31
    expect(t.calls.filter((c) => c.startsWith('events'))).toEqual(['events 31 10']);
  });

  it('does one fetch at a time and widens the next if a second hole appears meanwhile', async () => {
    const t = setup(range(1, 30));
    t.engine.start();
    await connect(t, 30);
    t.store.push(...range(31, 60));
    t.sockets.last.receive({ type: 'event', event: event(31) });
    t.sockets.last.receive({ type: 'event', event: event(40) });
    t.sockets.last.receive({ type: 'event', event: event(60) });
    await settle();
    await settle();
    expect(t.sink.log.contiguousSeq).toBe(60);
    expect(t.sink.seqs.slice(-30)).toEqual(Array.from({ length: 30 }, (_, i) => 31 + i));
  });
});

describe('trouble while filling a hole', () => {
  it('reconnects if the fetch for missing events fails', async () => {
    const t = setup(range(1, 30));
    t.engine.start();
    await connect(t, 30);
    vi.mocked(t.api.events).mockRejectedValueOnce(new ApiError('server', 'boom', 500));
    t.sockets.last.receive({ type: 'event', event: event(31) });
    t.sockets.last.receive({ type: 'event', event: event(35) });
    await settle();
    expect(t.sockets.sockets[0]!.closed).toBe(true);
    expect(t.logger.entries().some((e) => e.message.includes('could not catch up'))).toBe(true);
  });

  it('says so if a hole is still there after catching up', async () => {
    const t = setup(range(1, 30));
    t.engine.start();
    await connect(t, 30);
    t.store.push(...range(31, 31), ...range(36, 40));
    t.sockets.last.drop();
    await vi.advanceTimersByTimeAsync(499);
    await connect(t, 40);
    expect(t.logger.entries().some((e) => e.message.includes('still a hole'))).toBe(true);
  });

  it('gives up, and says so, rather than fetching forever', async () => {
    const t = setup(range(1, 30));
    t.engine.start();
    await connect(t, 30);
    vi.mocked(t.api.events).mockImplementation(async (since) => ({
      events: [event(since + 1)],
      lastSeq: 99999,
      more: true,
    }));
    t.sockets.last.receive({ type: 'event', event: event(31) });
    t.sockets.last.receive({ type: 'event', event: event(5000) });
    await settle();
    expect(t.logger.entries().some((e) => e.message.includes('gave up catching up'))).toBe(true);
    expect(vi.mocked(t.api.events).mock.calls.length).toBeLessThanOrEqual(101);
  });
});

describe('losing the connection', () => {
  it('waits, reconnects, and fetches only what it missed', async () => {
    const t = setup(range(1, 30));
    t.engine.start();
    await connect(t, 30);
    t.store.push(...range(31, 45));

    t.sockets.last.drop();
    expect(t.engine.state).toMatchObject({ status: 'waiting', attempt: 1 });
    await vi.advanceTimersByTimeAsync(499);
    expect(t.sockets.sockets).toHaveLength(2);

    await connect(t, 45);
    expect(t.engine.state.status).toBe('open');
    expect(t.calls.at(-1)).toBe('events 30 500');
    expect(t.sink.seqs.at(-1)).toBe(45);
    expect(t.sockets.last.sent).toEqual([{ type: 'subscribe', sinceSeq: 45 }]);
  });

  it('waits longer after each failed attempt and starts again from the beginning once one works for a while', async () => {
    const t = setup();
    t.engine.start();
    t.sockets.last.drop(); // 1st attempt fails to connect
    expect(t.engine.state).toMatchObject({ status: 'waiting', attempt: 1 });
    await vi.advanceTimersByTimeAsync(499);
    t.sockets.last.drop();
    expect(t.engine.state).toMatchObject({ status: 'waiting', attempt: 2 });
    await vi.advanceTimersByTimeAsync(999);
    t.sockets.last.open();
    await vi.advanceTimersByTimeAsync(11_000);
    t.sockets.last.drop();
    expect(t.engine.state).toMatchObject({ status: 'waiting', attempt: 1 });
  });

  it('treats a connection that has gone quiet as dead, closes it, and reconnects', async () => {
    const t = setup();
    t.engine.start();
    await connect(t);
    const first = t.sockets.last;
    // heartbeat is 1 s and the engine allows 2.5 of them
    await vi.advanceTimersByTimeAsync(2_499);
    expect(t.engine.state.status).toBe('open');
    await vi.advanceTimersByTimeAsync(1);
    expect(first.closed).toBe(true);
    expect(t.engine.state.status).toBe('waiting');
    await vi.advanceTimersByTimeAsync(499);
    expect(t.sockets.sockets).toHaveLength(2);
  });

  it('stays alive as long as it keeps hearing something', async () => {
    const t = setup();
    t.engine.start();
    await connect(t);
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(2_000);
      t.sockets.last.receive({ type: 'ping', at: 'x' });
    }
    expect(t.engine.state.status).toBe('open');
  });

  it('ignores late news from a socket it has already given up on', async () => {
    const t = setup();
    t.engine.start();
    await connect(t);
    const old = t.sockets.last;
    old.drop();
    await vi.advanceTimersByTimeAsync(499);
    await connect(t);
    const states = t.states.length;
    old.receive({ type: 'event', event: event(99) });
    old.drop();
    expect(t.sink.seqs).not.toContain(99);
    expect(t.states).toHaveLength(states);
    expect(t.engine.state.status).toBe('open');
  });

  it('reconnects when the catch-up request fails, instead of staying half connected', async () => {
    const t = setup();
    vi.mocked(t.api.latest).mockRejectedValueOnce(new ApiError('server', 'boom', 500));
    t.engine.start();
    await connect(t);
    expect(t.sockets.sockets[0]!.closed).toBe(true);
    t.sockets.sockets[0]!.drop();
    expect(t.engine.state.status).toBe('waiting');
    expect(t.logger.entries().some((e) => e.message.includes('could not catch up'))).toBe(true);
  });
});

describe('a server that starts its numbering again', () => {
  it('forgets what it holds and loads afresh, instead of waiting for numbers it will never see', async () => {
    const t = setup(range(1, 300));
    t.engine.start();
    await connect(t, 300);
    expect(t.sink.log.highestSeq).toBe(300);

    // the server starts over: its history is now 40 events, and the app's 300 are from the run before
    t.store.splice(0, t.store.length, ...range(1, 40));
    t.sockets.last.drop();
    await vi.advanceTimersByTimeAsync(499);
    await connect(t, 40);

    expect(t.sink.resets).toBe(1);
    expect(t.sink.log.highestSeq).toBe(40);
    expect(t.sockets.last.sent).toEqual([{ type: 'subscribe', sinceSeq: 40 }]);
    expect(t.logger.entries().some((e) => e.message.includes('numbering started again'))).toBe(true);
  });

  it('does not take a small difference between copies of a server for a restart', async () => {
    const t = setup(range(1, 300));
    t.engine.start();
    await connect(t, 300);
    t.sockets.last.drop();
    await vi.advanceTimersByTimeAsync(499);
    await connect(t, 295);
    expect(t.sink.resets).toBe(0);
    expect(t.sink.log.highestSeq).toBe(300);
  });

  it('is not triggered by a normal first connection', async () => {
    const t = setup(range(1, 30));
    t.engine.start();
    await connect(t, 30);
    expect(t.sink.resets).toBe(0);
  });
});

describe('the session ending', () => {
  it('stops for good and tells the app, rather than retrying with a login that no longer works', async () => {
    const t = setup();
    vi.mocked(t.api.latest).mockRejectedValueOnce(new ApiError('unauthorized', 'no', 401));
    t.engine.start();
    await connect(t);
    expect(t.engine.state).toEqual({ status: 'stopped' });
    expect(t.unauthorized).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.sockets.sockets).toHaveLength(1);
  });
});

describe('stopping and cutting', () => {
  it('stop closes the socket and does not come back', async () => {
    const t = setup();
    t.engine.start();
    await connect(t);
    t.engine.stop();
    expect(t.sockets.last.closed).toBe(true);
    t.sockets.last.drop(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.sockets.sockets).toHaveLength(1);
    expect(t.engine.state).toEqual({ status: 'stopped' });
  });

  it('can be started again after stopping', async () => {
    const t = setup();
    t.engine.start();
    await connect(t);
    t.engine.stop();
    t.engine.start();
    expect(t.sockets.sockets).toHaveLength(2);
    expect(t.engine.state.status).toBe('connecting');
  });

  it('sever drops the connection so the recovery can be watched, and the app recovers', async () => {
    const t = setup();
    t.engine.start();
    await connect(t);
    t.engine.sever();
    expect(t.sockets.last.closed).toBe(true);
    t.sockets.last.drop();
    expect(t.engine.state.status).toBe('waiting');
    await vi.advanceTimersByTimeAsync(499);
    await connect(t);
    expect(t.engine.state.status).toBe('open');
  });

  it('does nothing if started twice', () => {
    const t = setup();
    t.engine.start();
    t.engine.start();
    expect(t.sockets.sockets).toHaveLength(1);
  });
});

describe('reporting', () => {
  it('tells the app each time the state changes', async () => {
    const t = setup();
    t.engine.start();
    await connect(t);
    t.sockets.last.drop();
    expect(t.states.map((s) => s.status)).toEqual(['connecting', 'open', 'waiting']);
  });

  it('writes each change to the log', async () => {
    const t = setup();
    t.engine.start();
    await connect(t);
    expect(t.logger.entries().map((e) => e.message)).toContain('connection connecting → open');
  });
});
