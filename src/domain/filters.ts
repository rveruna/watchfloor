import type { Severity } from '@shared/protocol';
import type { EventLog } from './eventLog';
import type { MonitorEvent } from '@shared/protocol';

export interface EventFilter {
  severities: ReadonlySet<Severity>;
  deviceId: string | null;
  text: string;
  /** Show only events nobody has acknowledged that need it. */
  unacknowledgedOnly: boolean;
}

export const ALL_SEVERITIES: ReadonlySet<Severity> = new Set(['info', 'warning', 'critical']);

export function defaultFilter(): EventFilter {
  return { severities: ALL_SEVERITIES, deviceId: null, text: '', unacknowledgedOnly: false };
}

/** The events that match, newest first. */
export function filterEvents(
  log: EventLog,
  filter: EventFilter,
  deviceNames: Readonly<Record<string, string>> = {},
): MonitorEvent[] {
  const text = filter.text.trim().toLowerCase();
  const out: MonitorEvent[] = [];
  for (let i = log.ids.length - 1; i >= 0; i--) {
    const event = log.byId[log.ids[i]!]!;
    if (!filter.severities.has(event.severity)) continue;
    if (filter.deviceId && event.deviceId !== filter.deviceId) continue;
    if (filter.unacknowledgedOnly && (event.ack || event.severity === 'info')) continue;
    if (
      text &&
      !`${event.message} ${deviceNames[event.deviceId] ?? event.deviceId}`.toLowerCase().includes(text)
    )
      continue;
    out.push(event);
  }
  return out;
}

/** How many events there are at each severity, and how many alarms are waiting for someone. */
export function summarise(log: EventLog): {
  total: number;
  bySeverity: Record<Severity, number>;
  unacknowledgedCritical: number;
} {
  const bySeverity: Record<Severity, number> = { info: 0, warning: 0, critical: 0 };
  let unacknowledgedCritical = 0;
  for (const id of log.ids) {
    const e = log.byId[id]!;
    bySeverity[e.severity]++;
    if (e.severity === 'critical' && !e.ack) unacknowledgedCritical++;
  }
  return { total: log.ids.length, bySeverity, unacknowledgedCritical };
}
