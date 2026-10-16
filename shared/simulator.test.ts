import { describe, expect, it } from 'vitest';
import { eventSchema } from './protocol';
import { createSimulator, DEVICES, mulberry32 } from './simulator';

describe('mulberry32', () => {
  it('gives the same numbers for the same seed, and different ones for another', () => {
    const a = mulberry32(1);
    const b = mulberry32(1);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(mulberry32(2)()).not.toBe(mulberry32(1)());
  });

  it('stays between 0 and 1', () => {
    const r = mulberry32(99);
    for (let i = 0; i < 1000; i++) {
      const n = r();
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(1);
    }
  });
});

describe('createSimulator', () => {
  const start = Date.UTC(2026, 9, 16, 9, 0, 0);

  it('numbers events from 1 with no gaps', () => {
    const events = createSimulator({ seed: 3, start }).take(50);
    expect(events.map((e) => e.seq)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  });

  it('is repeatable', () => {
    expect(createSimulator({ seed: 3, start }).take(30)).toEqual(
      createSimulator({ seed: 3, start }).take(30),
    );
    expect(createSimulator({ seed: 4, start }).take(30)).not.toEqual(
      createSimulator({ seed: 3, start }).take(30),
    );
  });

  it('makes events that match the contract, about devices that exist, moving forward in time', () => {
    const events = createSimulator({ seed: 11, start }).take(300);
    const ids = new Set(DEVICES.map((d) => d.id));
    let last = start;
    for (const e of events) {
      expect(eventSchema.safeParse(e).success).toBe(true);
      expect(ids.has(e.deviceId)).toBe(true);
      const at = Date.parse(e.at);
      expect(at).toBeGreaterThan(last);
      last = at;
    }
  });

  it('only gives a kind of event to a kind of device that could have it', () => {
    const byId = new Map(DEVICES.map((d) => [d.id, d]));
    for (const e of createSimulator({ seed: 5, start }).take(500)) {
      const kind = byId.get(e.deviceId)!.kind;
      if (e.kind === 'door_open') expect(kind).toBe('door');
      if (e.kind === 'motion') expect(kind).toBe('camera');
      if (e.kind === 'went_offline' || e.kind === 'came_online') expect(kind).not.toBe('door');
    }
  });

  it('makes mostly ordinary events and a few that matter', () => {
    const events = createSimulator({ seed: 21, start }).take(2000);
    const count = (s: string) => events.filter((e) => e.severity === s).length;
    expect(count('info')).toBeGreaterThan(count('warning'));
    expect(count('warning')).toBeGreaterThan(count('critical'));
    expect(count('critical')).toBeGreaterThan(0);
  });

  it('reports the last sequence number and a sensible wait between events', () => {
    const sim = createSimulator({ seed: 1, start });
    expect(sim.lastSeq).toBe(0);
    sim.take(3);
    expect(sim.lastSeq).toBe(3);
    const gap = sim.gap();
    expect(gap).toBeGreaterThanOrEqual(800);
    expect(gap).toBeLessThan(3000);
  });

  it('works with a smaller set of devices', () => {
    const one = [DEVICES[0]!];
    const events = createSimulator({ seed: 2, start, devices: one }).take(20);
    expect(events.every((e) => e.deviceId === one[0]!.id)).toBe(true);
  });

  it('still makes an event if no device suits the kind it picked', () => {
    const doors = DEVICES.filter((d) => d.kind === 'door');
    const events = createSimulator({ seed: 8, start, devices: doors }).take(200);
    expect(events).toHaveLength(200);
    expect(events.every((e) => doors.some((d) => d.id === e.deviceId))).toBe(true);
  });
});
