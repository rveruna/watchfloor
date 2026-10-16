import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerMessage, User } from '../shared/protocol';
import { createClockDeployment, memoryAckStore } from './clockDeployment';

const epoch = Date.UTC(2026, 9, 12, 0, 0, 0);
const operator: User = { name: 'Operator', role: 'operator' };
const viewer: User = { name: 'Viewer', role: 'viewer' };

let clock: number;
const at = (hours: number) => epoch + hours * 3_600_000;
const make = (store = memoryAckStore(), options = {}) =>
  createClockDeployment({ epoch, now: () => clock, store, ...options });

beforeEach(() => {
  vi.useFakeTimers();
  clock = at(2);
});
afterEach(() => vi.useRealTimers());

describe('events that follow from the clock', () => {
  it('has made every event that has happened by now, numbered from 1 with none missing', async () => {
    const d = make();
    const all = await d.eventsSince(0, 1_000);
    expect(all.events.length).toBe(1_000);
    expect(all.events.map((e) => e.seq)).toEqual(Array.from({ length: 1_000 }, (_, i) => i + 1));
    expect(all.lastSeq).toBeGreaterThan(1_000);
    expect(all.more).toBe(true);
    expect(Date.parse(all.events.at(-1)!.at)).toBeLessThanOrEqual(clock);
  });

  it('counts an event that happens at exactly this moment', async () => {
    const later = make();
    clock = at(2);
    const third = (await later.eventsSince(2, 1)).events[0]!;
    clock = Date.parse(third.at);
    const exact = make();
    expect(await exact.lastSeq()).toBe(third.seq);
    clock -= 1;
    expect(await make().lastSeq()).toBe(third.seq - 1);
  });

  it('is the same on two copies that share nothing but the seed and the epoch', async () => {
    const a = make();
    const b = make();
    expect(await a.latest(50)).toEqual(await b.latest(50));
    expect(await a.lastSeq()).toBe(await b.lastSeq());
  });

  it('is the same whether a copy has been running all along or has just started', async () => {
    const early = make();
    clock = at(1);
    await early.lastSeq();
    clock = at(5);
    const late = make();
    expect(await early.latest(100)).toEqual(await late.latest(100));
  });

  it('makes more events as time passes, and none before their time', async () => {
    const d = make();
    const before = await d.lastSeq();
    clock += 60_000;
    const after = await d.lastSeq();
    expect(after).toBeGreaterThan(before);
    const latest = (await d.latest(1)).events[0]!;
    expect(Date.parse(latest.at)).toBeLessThanOrEqual(clock);
    expect(Date.parse(latest.at)).toBeGreaterThan(clock - 6_000);
  });

  it('stops making events at its ceiling rather than growing for ever', async () => {
    const d = make(memoryAckStore(), { maxEvents: 500 });
    expect(await d.lastSeq()).toBe(500);
    clock += 3_600_000;
    expect(await d.lastSeq()).toBe(500);
  });

  it('pages: events after a number, how many, and whether there are more', async () => {
    const d = make();
    const page = await d.eventsSince(10, 5);
    expect(page.events.map((e) => e.seq)).toEqual([11, 12, 13, 14, 15]);
    expect(page.more).toBe(true);
    const last = await d.lastSeq();
    expect(await d.eventsSince(last, 10)).toEqual({ events: [], lastSeq: last, more: false });
    expect((await d.latest(3)).events.map((e) => e.seq)).toEqual([last - 2, last - 1, last]);
  });

  it('knows which devices are offline from the events that took them offline', async () => {
    const d = make();
    clock = at(30);
    const devices = await d.devices();
    const events = (await d.eventsSince(0, 100_000)).events;
    for (const device of devices) {
      const last = events
        .filter((e) => e.deviceId === device.id && (e.kind === 'went_offline' || e.kind === 'came_online'))
        .at(-1);
      expect(device.status).toBe(!last || last.kind === 'came_online' ? 'online' : 'offline');
    }
    expect(devices.some((x) => x.status === 'offline')).toBe(true);
  });

  it('describes itself and knows the two demo accounts', () => {
    const d = make();
    expect(d.about()).toMatchObject({ product: 'monitor' });
    expect(d.authenticate('operator@example.com', 'operator')).toEqual(operator);
    expect(d.authenticate('operator@example.com', 'wrong')).toBeNull();
  });
});

describe('acknowledging with a store shared between copies', () => {
  const firstAlarm = async (d: ReturnType<typeof make>) =>
    (await d.eventsSince(0, 5_000)).events.find((e) => e.severity === 'critical')!;

  it('records the first acknowledgement, and tells the second person it was already done', async () => {
    const d = make();
    const alarm = await firstAlarm(d);
    expect(await d.acknowledge(alarm.id, operator)).toMatchObject({ status: 'ok', ack: { by: 'Operator' } });
    expect(await d.acknowledge(alarm.id, { name: 'Night shift', role: 'operator' })).toMatchObject({
      status: 'already',
      ack: { by: 'Operator' },
    });
  });

  it('is seen by another copy, in lists and in the latest events', async () => {
    const store = memoryAckStore();
    const a = make(store);
    const b = make(store);
    const alarm = await firstAlarm(a);
    await a.acknowledge(alarm.id, operator);
    const seen = (await b.eventsSince(alarm.seq - 1, 1)).events[0]!;
    expect(seen.ack?.by).toBe('Operator');
    clock = at(2);
    const latest = await b.latest(10_000);
    expect(latest.events.find((e) => e.id === alarm.id)?.ack?.by).toBe('Operator');
  });

  it('lets the newest event be acknowledged, and not the one after it', async () => {
    const d = make();
    const last = await d.lastSeq();
    expect((await d.acknowledge(`evt-${last}`, operator)).status).toBe('ok');
    expect(await d.acknowledge(`evt-${last + 1}`, operator)).toEqual({ status: 'missing' });
  });

  it('refuses a viewer, an event that does not exist, one from the future and one with a made-up name', async () => {
    const d = make();
    expect(await d.acknowledge('evt-1', viewer)).toEqual({ status: 'forbidden' });
    for (const id of ['evt-0', 'evt-99999999', 'nonsense', 'evt-1x', '']) {
      expect(await d.acknowledge(id, operator)).toEqual({ status: 'missing' });
    }
  });
});

describe('following', () => {
  const collect = (d: ReturnType<typeof make>, since: number) => {
    const messages: ServerMessage[] = [];
    const stop = d.follow(since, (m) => messages.push(m));
    return { messages, stop };
  };
  const events = (m: ServerMessage[]) =>
    m.filter((x) => x.type === 'event').map((x) => (x as { event: { seq: number } }).event.seq);

  it('sends everything after the number asked for, then each new event as it happens', async () => {
    const d = make();
    const last = await d.lastSeq();
    const { messages, stop } = collect(d, last - 3);
    await vi.advanceTimersByTimeAsync(0);
    expect(events(messages)).toEqual([last - 2, last - 1, last]);
    clock += 30_000;
    await vi.advanceTimersByTimeAsync(1_000);
    const seen = events(messages);
    expect(seen.length).toBeGreaterThan(3);
    expect(seen).toEqual(Array.from({ length: seen.length }, (_, i) => last - 2 + i));
    stop();
  });

  it('puts an existing acknowledgement on the event it replays', async () => {
    const store = memoryAckStore();
    const d = make(store);
    const alarm = (await d.latest(150)).events.find((e) => e.severity === 'critical')!;
    await d.acknowledge(alarm.id, operator);
    const { messages, stop } = collect(make(store), alarm.seq - 1);
    await vi.advanceTimersByTimeAsync(0);
    const first = messages.find((m) => m.type === 'event') as { event: { ack?: { by: string } } };
    expect(first.event.ack?.by).toBe('Operator');
    // it arrived with its acknowledgement, so it is not announced again as if it were news
    await vi.advanceTimersByTimeAsync(2_000);
    expect(messages.filter((m) => m.type === 'ack')).toEqual([]);
    stop();
  });

  it('tells a follower when another copy takes an acknowledgement', async () => {
    const store = memoryAckStore();
    const mine = make(store);
    const theirs = make(store);
    const last = await mine.lastSeq();
    const alarmEvent = (await mine.latest(RECENT_ALARM_WINDOW)).events.find((e) => e.severity === 'critical');
    expect(alarmEvent).toBeDefined();
    const { messages, stop } = collect(mine, last);
    await vi.advanceTimersByTimeAsync(0);
    await theirs.acknowledge(alarmEvent!.id, operator);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(messages).toContainEqual({
      type: 'ack',
      eventId: alarmEvent!.id,
      ack: expect.objectContaining({ by: 'Operator' }),
    });
    // and only once
    await vi.advanceTimersByTimeAsync(5_000);
    expect(messages.filter((m) => m.type === 'ack' && m.eventId === alarmEvent!.id)).toHaveLength(1);
    stop();
  });

  it('says when a device goes offline or comes back, with the status it had then', async () => {
    const d = make();
    const { messages, stop } = collect(d, 0);
    await vi.advanceTimersByTimeAsync(0);
    const changes = messages.filter((m) => m.type === 'device');
    expect(changes.length).toBeGreaterThan(0);
    for (const c of changes)
      if (c.type === 'device') expect(['online', 'offline']).toContain(c.device.status);
    stop();
  });

  it('stops sending when stopped', async () => {
    const d = make();
    const last = await d.lastSeq();
    const { messages, stop } = collect(d, last);
    await vi.advanceTimersByTimeAsync(0);
    stop();
    const before = messages.length;
    clock += 60_000;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(messages).toHaveLength(before);
  });
});

const RECENT_ALARM_WINDOW = 200;
