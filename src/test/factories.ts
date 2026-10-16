import type { MonitorEvent } from '@shared/protocol';

export function event(seq: number, overrides: Partial<MonitorEvent> = {}): MonitorEvent {
  return {
    id: `evt-${seq}`,
    seq,
    at: new Date(Date.UTC(2026, 9, 16, 12, 0, seq)).toISOString(),
    deviceId: 'cam-lobby',
    kind: 'motion',
    severity: 'info',
    message: `Motion detected on Lobby camera (${seq})`,
    ...overrides,
  };
}

export const alarm = (seq: number, overrides: Partial<MonitorEvent> = {}) =>
  event(seq, {
    kind: 'alarm',
    severity: 'critical',
    message: `Alarm ${seq}`,
    deviceId: 'door-front',
    ...overrides,
  });
