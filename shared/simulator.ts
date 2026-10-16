import type { Device, MonitorEvent, Severity } from './protocol.js';

/**
 * Invents a believable stream of events for a few sites. It is deterministic: the same seed and the same number of
 * steps always give the same events, so tests can say exactly what they expect and the demo behaves the same every time.
 * It is used by the mock server and, in the browser, as the demo's stand-in for one.
 */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DEVICES: readonly Device[] = [
  { id: 'cam-lobby', name: 'Lobby camera', kind: 'camera', site: 'Harbour House', status: 'online' },
  { id: 'cam-yard', name: 'Yard camera', kind: 'camera', site: 'Harbour House', status: 'online' },
  { id: 'door-front', name: 'Front door', kind: 'door', site: 'Harbour House', status: 'online' },
  { id: 'door-store', name: 'Store room door', kind: 'door', site: 'Harbour House', status: 'online' },
  { id: 'cam-dock', name: 'Loading dock camera', kind: 'camera', site: 'Granton Depot', status: 'online' },
  { id: 'door-gate', name: 'Depot gate', kind: 'door', site: 'Granton Depot', status: 'online' },
  { id: 'sensor-temp', name: 'Cold store sensor', kind: 'sensor', site: 'Granton Depot', status: 'online' },
  {
    id: 'sensor-smoke',
    name: 'Workshop smoke sensor',
    kind: 'sensor',
    site: 'Granton Depot',
    status: 'online',
  },
];

type Template = {
  kind: MonitorEvent['kind'];
  severity: Severity;
  weight: number;
  message: (d: Device) => string;
  kinds: Device['kind'][];
};

const TEMPLATES: Template[] = [
  {
    kind: 'motion',
    severity: 'info',
    weight: 50,
    kinds: ['camera'],
    message: (d) => `Motion detected on ${d.name}`,
  },
  { kind: 'door_open', severity: 'info', weight: 25, kinds: ['door'], message: (d) => `${d.name} opened` },
  {
    kind: 'went_offline',
    severity: 'warning',
    weight: 6,
    kinds: ['camera', 'sensor'],
    message: (d) => `${d.name} stopped responding`,
  },
  {
    kind: 'came_online',
    severity: 'info',
    weight: 6,
    kinds: ['camera', 'sensor'],
    message: (d) => `${d.name} is back online`,
  },
  {
    kind: 'tamper',
    severity: 'warning',
    weight: 5,
    kinds: ['camera', 'door'],
    message: (d) => `Possible tampering at ${d.name}`,
  },
  {
    kind: 'alarm',
    severity: 'critical',
    weight: 4,
    kinds: ['door', 'sensor'],
    message: (d) => `Alarm raised by ${d.name}`,
  },
];

export interface SimulatorOptions {
  seed: number;
  /** The time of event number 1. Later events follow at irregular gaps. */
  start: number;
  devices?: readonly Device[];
}

export interface Simulator {
  /** Makes the next event. */
  next(): MonitorEvent;
  /** Makes the next `count` events. */
  take(count: number): MonitorEvent[];
  /** The sequence number of the last event made, or 0 if none. */
  readonly lastSeq: number;
  /** The milliseconds to wait before the next event, as a person watching would see them arrive. */
  gap(): number;
}

export function createSimulator({ seed, start, devices = DEVICES }: SimulatorOptions): Simulator {
  const random = mulberry32(seed);
  const totalWeight = TEMPLATES.reduce((sum, t) => sum + t.weight, 0);
  let seq = 0;
  let clock = start;

  function pickTemplate(): Template {
    let roll = random() * totalWeight;
    for (const t of TEMPLATES) {
      roll -= t.weight;
      if (roll < 0) return t;
    }
    return TEMPLATES[0]!;
  }

  function next(): MonitorEvent {
    const template = pickTemplate();
    const candidates = devices.filter((d) => template.kinds.includes(d.kind));
    const device = candidates[Math.floor(random() * candidates.length)] ?? devices[0]!;
    seq += 1;
    clock += 500 + Math.floor(random() * 4500);
    return {
      id: `evt-${seq}`,
      seq,
      at: new Date(clock).toISOString(),
      deviceId: device.id,
      kind: template.kind,
      severity: template.severity,
      message: template.message(device),
    };
  }

  return {
    next,
    take: (count) => Array.from({ length: count }, next),
    get lastSeq() {
      return seq;
    },
    gap: () => 800 + Math.floor(random() * 2200),
  };
}
