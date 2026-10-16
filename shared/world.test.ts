import { describe, expect, it } from 'vitest';
import type { ServerMessage } from './protocol';
import { FEATURES, VERSION, World } from './world';

const start = Date.UTC(2026, 9, 16, 9, 0, 0);
const make = (preload = 10) => new World({ seed: 7, start, preload, now: () => start + 60_000 });

describe('a deployment', () => {
  it('describes itself, so the app can match its features', () => {
    expect(make().about()).toEqual({ version: VERSION, product: 'monitor', features: [...FEATURES] });
  });

  it('starts with history', () => {
    const world = make(25);
    expect(world.lastSeq).toBe(25);
    expect(world.eventsSince(0, 100).events).toHaveLength(25);
  });

  it('lists its devices as copies, so callers cannot change them', () => {
    const world = make();
    world.devices()[0]!.name = 'changed';
    expect(world.devices()[0]!.name).not.toBe('changed');
  });
});

describe('signing in', () => {
  it('knows an operator and a viewer', () => {
    const world = make();
    expect(world.authenticate('operator@example.com', 'operator')).toEqual({
      name: 'Operator',
      role: 'operator',
    });
    expect(world.authenticate('  Viewer@Example.com ', 'viewer')).toEqual({ name: 'Viewer', role: 'viewer' });
  });

  it('refuses a wrong password or an unknown person', () => {
    const world = make();
    expect(world.authenticate('operator@example.com', 'nope')).toBeNull();
    expect(world.authenticate('nobody@example.com', 'operator')).toBeNull();
  });
});

describe('fetching events', () => {
  it('returns a page after a sequence number and says whether there is more', () => {
    const world = make(30);
    const page = world.eventsSince(10, 5);
    expect(page.events.map((e) => e.seq)).toEqual([11, 12, 13, 14, 15]);
    expect(page.more).toBe(true);
    expect(page.lastSeq).toBe(30);
    expect(world.eventsSince(25, 100).more).toBe(false);
  });

  it('returns the newest few, oldest first', () => {
    const page = make(30).latest(4);
    expect(page.events.map((e) => e.seq)).toEqual([27, 28, 29, 30]);
  });

  it('returns nothing, without error, after the last one', () => {
    expect(make(5).eventsSince(99, 10)).toEqual({ events: [], lastSeq: 5, more: false });
  });
});

describe('things happening', () => {
  it('tells everyone listening, and stops when they stop listening', () => {
    const world = make(3);
    const heard: ServerMessage[] = [];
    const stop = world.subscribe((m) => heard.push(m));
    const event = world.tick();
    expect(heard).toContainEqual({ type: 'event', event });
    expect(event.seq).toBe(4);
    stop();
    const before = heard.length;
    world.tick();
    expect(heard).toHaveLength(before);
  });

  it('changes a device when it goes offline or comes back, and says so', () => {
    const world = make(0);
    const heard: ServerMessage[] = [];
    world.subscribe((m) => heard.push(m));
    for (let i = 0; i < 400; i++) world.tick();
    const changes = heard.filter((m) => m.type === 'device');
    expect(changes.length).toBeGreaterThan(0);
    for (const c of changes) {
      if (c.type === 'device') expect(world.devices().find((d) => d.id === c.device.id)).toBeDefined();
    }
  });

  it('gives a wait until the next one', () => {
    expect(make().nextGap()).toBeGreaterThan(0);
  });

  it('does not keep more than it should', () => {
    const world = new World({ seed: 1, start, preload: 10_050 });
    expect(world.eventsSince(0, 20_000).events.length).toBeLessThanOrEqual(10_000);
    expect(world.lastSeq).toBe(10_050);
  });
});

describe('acknowledging', () => {
  const operator = { name: 'Operator', role: 'operator' } as const;

  it('records who and when, and tells listeners', () => {
    const world = make(30);
    const target =
      world.eventsSince(0, 100).events.find((e) => e.severity === 'critical') ?? world.latest(1).events[0]!;
    const heard: ServerMessage[] = [];
    world.subscribe((m) => heard.push(m));
    const result = world.acknowledge(target.id, operator);
    expect(result).toEqual({
      status: 'ok',
      ack: { by: 'Operator', at: new Date(start + 60_000).toISOString() },
    });
    expect(heard).toContainEqual({ type: 'ack', eventId: target.id, ack: (result as { ack: unknown }).ack });
  });

  it('keeps the first acknowledgement and says it was already done', () => {
    const world = make(5);
    world.acknowledge('evt-1', operator);
    const again = world.acknowledge('evt-1', { name: 'Someone', role: 'operator' });
    expect(again.status).toBe('already');
    expect((again as { ack: { by: string } }).ack.by).toBe('Operator');
  });

  it('refuses a viewer, and changes nothing', () => {
    const world = make(5);
    expect(world.acknowledge('evt-1', { name: 'Viewer', role: 'viewer' })).toEqual({ status: 'forbidden' });
    expect(world.eventsSince(0, 10).events[0]!.ack).toBeUndefined();
  });

  it('says so for an event that does not exist, and does not tell anyone', () => {
    const world = make(5);
    const heard: ServerMessage[] = [];
    world.subscribe((m) => heard.push(m));
    expect(world.acknowledge('evt-999', operator)).toEqual({ status: 'missing' });
    expect(heard).toEqual([]);
  });
});

describe('the ticker', () => {
  it('makes events happen one after another until stopped', async () => {
    const { vi } = await import('vitest');
    const { startTicker } = await import('./world');
    vi.useFakeTimers();
    const world = make(0);
    const stop = startTicker(world);
    await vi.advanceTimersByTimeAsync(20_000);
    const made = world.lastSeq;
    expect(made).toBeGreaterThan(3);
    stop();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(world.lastSeq).toBe(made);
    vi.useRealTimers();
  });

  it('does not make one more after it is stopped from inside the wait', async () => {
    const { vi } = await import('vitest');
    const { startTicker } = await import('./world');
    vi.useFakeTimers();
    const world = make(0);
    const stop = startTicker(world);
    stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(world.lastSeq).toBe(0);
    vi.useRealTimers();
  });
});
