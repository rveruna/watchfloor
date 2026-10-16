import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { World } from '@shared/world';
import { createDemoApi } from './demoApi';
import { createDemoSocketFactory, streamUrl, webSocketFactory } from './socket';

const start = Date.UTC(2026, 9, 16, 9, 0, 0);
const world = () => new World({ seed: 7, start, preload: 20, now: () => start + 1000 });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('the demo API', () => {
  const answer = async <T>(promise: Promise<T>) => {
    const result = promise.then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    await vi.advanceTimersByTimeAsync(100);
    return result;
  };

  it('describes the deployment before anyone has signed in', async () => {
    const api = createDemoApi(world());
    expect(await answer(api.about())).toMatchObject({ value: { product: 'monitor' } });
  });

  it('refuses to show anything until somebody has signed in', async () => {
    const api = createDemoApi(world());
    expect(await answer(api.me())).toEqual({ value: null });
    expect(await answer(api.devices())).toMatchObject({ error: { kind: 'unauthorized' } });
    expect(await answer(api.latest(5))).toMatchObject({ error: { kind: 'unauthorized' } });
    expect(await answer(api.events(0, 5))).toMatchObject({ error: { kind: 'unauthorized' } });
  });

  it('refuses a wrong password', async () => {
    const api = createDemoApi(world());
    expect(await answer(api.login('operator@example.com', 'wrong'))).toMatchObject({
      error: { kind: 'unauthorized' },
    });
  });

  it('shows devices and events once signed in, and forgets the person when they sign out', async () => {
    const api = createDemoApi(world());
    expect(await answer(api.login('viewer@example.com', 'viewer'))).toEqual({
      value: { name: 'Viewer', role: 'viewer' },
    });
    expect(await answer(api.me())).toEqual({ value: { name: 'Viewer', role: 'viewer' } });
    expect(await answer(api.devices())).toMatchObject({
      value: expect.arrayContaining([expect.objectContaining({ id: 'cam-lobby' })]),
    });
    expect(await answer(api.latest(5))).toMatchObject({ value: { events: expect.any(Array), lastSeq: 20 } });
    expect(await answer(api.events(15, 100))).toMatchObject({ value: { more: false } });
    await answer(api.logout());
    expect(await answer(api.me())).toEqual({ value: null });
  });

  it('lets an operator acknowledge, and tells a second person someone already had', async () => {
    const w = world();
    const a = createDemoApi(w);
    await answer(a.login('operator@example.com', 'operator'));
    const first = await answer(a.acknowledge('evt-1'));
    expect(first).toMatchObject({ value: { already: false, ack: { by: 'Operator' } } });
    expect(await answer(a.acknowledge('evt-1'))).toMatchObject({ value: { already: true } });
  });

  it('does not let a viewer acknowledge, or acknowledge something that is not there, or acknowledge when signed out', async () => {
    const w = world();
    const viewer = createDemoApi(w);
    expect(await answer(viewer.acknowledge('evt-1'))).toMatchObject({ error: { kind: 'unauthorized' } });
    await answer(viewer.login('viewer@example.com', 'viewer'));
    expect(await answer(viewer.acknowledge('evt-1'))).toMatchObject({ error: { kind: 'forbidden' } });
    const operator = createDemoApi(w);
    await answer(operator.login('operator@example.com', 'operator'));
    expect(await answer(operator.acknowledge('evt-999'))).toMatchObject({ error: { kind: 'not_found' } });
  });

  it('takes a moment to answer, like a real server', async () => {
    const api = createDemoApi(world(), { latencyMs: 500 });
    let done = false;
    void api.about().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(499);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });
});

describe('the demo socket', () => {
  function connect(w = world(), heartbeatMs = 1000) {
    const received: unknown[] = [];
    const closes: Array<{ clean: boolean; code: number }> = [];
    let opened = false;
    const socket = createDemoSocketFactory(w, { heartbeatMs })({
      open: () => (opened = true),
      message: (text) => received.push(JSON.parse(text)),
      close: (info) => closes.push(info),
    });
    return {
      socket,
      received,
      closes,
      w,
      get opened() {
        return opened;
      },
    };
  }

  it('opens and says hello, but sends no events until asked', async () => {
    const c = connect();
    await vi.advanceTimersByTimeAsync(0);
    expect(c.opened).toBe(true);
    expect(c.received).toEqual([expect.objectContaining({ type: 'hello', lastSeq: 20, heartbeatMs: 1000 })]);
    c.w.tick();
    expect(c.received).toHaveLength(1);
  });

  it('replays what was missed from the number asked for, then sends new events as they happen', async () => {
    const c = connect();
    await vi.advanceTimersByTimeAsync(0);
    c.socket.send(JSON.stringify({ type: 'subscribe', sinceSeq: 17 }));
    expect(c.received.slice(1).map((m) => (m as { event: { seq: number } }).event.seq)).toEqual([18, 19, 20]);
    c.w.tick();
    expect(c.received.at(-1)).toMatchObject({ type: 'event', event: { seq: 21 } });
  });

  it('sends acknowledgements too, and ignores a second subscribe or nonsense', async () => {
    const c = connect();
    await vi.advanceTimersByTimeAsync(0);
    c.socket.send('nonsense');
    c.socket.send(JSON.stringify({ type: 'pong', at: 'x' }));
    c.socket.send(JSON.stringify({ type: 'subscribe', sinceSeq: 20 }));
    c.socket.send(JSON.stringify({ type: 'subscribe', sinceSeq: 0 }));
    expect(c.received).toHaveLength(1);
    c.w.acknowledge('evt-3', { name: 'Operator', role: 'operator' });
    expect(c.received.at(-1)).toMatchObject({ type: 'ack', eventId: 'evt-3' });
  });

  it('sends a ping every heartbeat', async () => {
    const c = connect();
    await vi.advanceTimersByTimeAsync(3_100);
    expect(c.received.filter((m) => (m as { type: string }).type === 'ping')).toHaveLength(3);
  });

  it('closes cleanly when asked, then says nothing more', async () => {
    const c = connect();
    await vi.advanceTimersByTimeAsync(0);
    c.socket.send(JSON.stringify({ type: 'subscribe', sinceSeq: 20 }));
    c.socket.close();
    await vi.advanceTimersByTimeAsync(0);
    expect(c.closes).toEqual([{ clean: true, code: 1000 }]);
    const before = c.received.length;
    c.w.tick();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(c.received).toHaveLength(before);
    c.socket.close();
    await vi.advanceTimersByTimeAsync(0);
    expect(c.closes).toHaveLength(1);
  });

  it('never opens if it is closed straight away', async () => {
    const c = connect();
    c.socket.close();
    await vi.advanceTimersByTimeAsync(10);
    expect(c.opened).toBe(false);
  });
});

describe('the real socket', () => {
  class FakeWebSocket {
    static last: FakeWebSocket;
    sent: string[] = [];
    closed = false;
    onopen: (() => void) | null = null;
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onclose: ((e: { wasClean: boolean; code: number }) => void) | null = null;
    constructor(readonly url: string) {
      FakeWebSocket.last = this;
    }
    send(text: string) {
      this.sent.push(text);
    }
    close() {
      this.closed = true;
    }
  }

  it('connects to the address and passes everything through', () => {
    const seen: string[] = [];
    const closes: unknown[] = [];
    let opened = 0;
    const socket = webSocketFactory(
      'ws://x/stream',
      FakeWebSocket as never,
    )({
      open: () => opened++,
      message: (t) => seen.push(t),
      close: (i) => closes.push(i),
    });
    const ws = FakeWebSocket.last;
    expect(ws.url).toBe('ws://x/stream');
    ws.onopen?.();
    ws.onmessage?.({ data: 'hello' });
    ws.onmessage?.({ data: new ArrayBuffer(2) });
    ws.onclose?.({ wasClean: false, code: 1006 });
    socket.send('out');
    socket.close();
    expect([opened, seen, closes]).toEqual([1, ['hello', ''], [{ clean: false, code: 1006 }]]);
    expect(ws.sent).toEqual(['out']);
    expect(ws.closed).toBe(true);
  });

  it('works out the stream address from the page address', () => {
    expect(streamUrl({ protocol: 'https:', host: 'a.dev' })).toBe('wss://a.dev/api/v1/stream');
    expect(streamUrl({ protocol: 'http:', host: 'localhost:5173' })).toBe(
      'ws://localhost:5173/api/v1/stream',
    );
  });
});
