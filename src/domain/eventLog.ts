import type { Ack, MonitorEvent } from '@shared/protocol';

/**
 * The events the app is holding. Plain data and pure functions, so what happens when events arrive twice, late, or with
 * some missing is decided here and tested here, not inside a component.
 */

export interface EventLog {
  /** Event ids, oldest first (by sequence number). */
  ids: string[];
  byId: Record<string, MonitorEvent>;
  /** The highest sequence number seen without a hole before it. Everything up to here is held, or was dropped on purpose. */
  contiguousSeq: number;
  /** The highest sequence number seen at all. */
  highestSeq: number;
  /** How many events were let go to stay within capacity. */
  dropped: number;
}

export const DEFAULT_CAPACITY = 2_000;

export function emptyLog(): EventLog {
  return { ids: [], byId: {}, contiguousSeq: 0, highestSeq: 0, dropped: 0 };
}

/** A hole in the sequence: events `from` to `to` (inclusive) have not been seen. */
export interface Gap {
  from: number;
  to: number;
}

/** Whether somebody needs to look at this: a critical event nobody has acknowledged. It is never the one let go. */
export function needsAttention(event: MonitorEvent): boolean {
  return event.severity === 'critical' && !event.ack;
}

export function applyEvent(
  log: EventLog,
  event: MonitorEvent,
  capacity = DEFAULT_CAPACITY,
): { log: EventLog; gap: Gap | null; added: boolean } {
  if (log.byId[event.id]) return { log, gap: null, added: false };
  // the first event ever seen sets the starting point, so history before it is not counted as missing
  const base = log.highestSeq === 0 ? event.seq - 1 : log.contiguousSeq;
  // anything at or below the contiguous point that is not held was already let go
  if (event.seq <= base) return { log, gap: null, added: false };

  const gap: Gap | null =
    log.highestSeq > 0 && event.seq > log.highestSeq + 1
      ? { from: log.highestSeq + 1, to: event.seq - 1 }
      : null;

  const ids = insertBySeq(log.ids, log.byId, event);
  const byId = { ...log.byId, [event.id]: event };
  const contiguousSeq = advance(base, ids, byId);
  return {
    log: trim(
      { ...log, ids, byId, highestSeq: Math.max(log.highestSeq, event.seq), contiguousSeq },
      capacity,
    ),
    gap,
    added: true,
  };
}

/** Adds a batch, such as a page fetched to fill a hole. Returns the log and any hole that is still there. */
export function mergeEvents(
  log: EventLog,
  events: MonitorEvent[],
  capacity = DEFAULT_CAPACITY,
): { log: EventLog; gap: Gap | null } {
  let current = log;
  for (const event of [...events].sort((a, b) => a.seq - b.seq))
    current = applyEvent(current, event, capacity).log;
  return { log: current, gap: firstGap(current) };
}

/** The first hole in the sequence, or null. */
export function firstGap(log: EventLog): Gap | null {
  if (log.contiguousSeq >= log.highestSeq) return null;
  let expected = log.contiguousSeq + 1;
  for (const id of log.ids) {
    const seq = log.byId[id]!.seq;
    if (seq < expected) continue;
    if (seq > expected) return { from: expected, to: seq - 1 };
    expected = seq + 1;
  }
  return null;
}

export function applyAck(log: EventLog, eventId: string, ack: Ack): EventLog {
  const event = log.byId[eventId];
  if (!event || event.ack) return log;
  return { ...log, byId: { ...log.byId, [eventId]: { ...event, ack } } };
}

/** Takes an acknowledgement back, as when the server refused it. */
export function removeAck(log: EventLog, eventId: string): EventLog {
  const event = log.byId[eventId];
  if (!event?.ack) return log;
  const { ack: _ack, ...rest } = event;
  return { ...log, byId: { ...log.byId, [eventId]: rest } };
}

function insertBySeq(ids: string[], byId: Record<string, MonitorEvent>, event: MonitorEvent): string[] {
  const last = ids.at(-1);
  if (last === undefined || byId[last]!.seq < event.seq) return [...ids, event.id];
  // late arrival: find where it belongs, searching from the end because it is usually only a little late
  let at = ids.length;
  while (at > 0 && byId[ids[at - 1]!]!.seq > event.seq) at--;
  return [...ids.slice(0, at), event.id, ...ids.slice(at)];
}

function advance(from: number, ids: string[], byId: Record<string, MonitorEvent>): number {
  const seen = new Set<number>();
  for (const id of ids) seen.add(byId[id]!.seq);
  let seq = from;
  while (seen.has(seq + 1)) seq++;
  return seq;
}

function trim(log: EventLog, capacity: number): EventLog {
  if (log.ids.length <= capacity) return log;
  let excess = log.ids.length - capacity;
  const keep: string[] = [];
  const byId = { ...log.byId };
  let dropped = 0;
  // let go of the oldest first, but never an unacknowledged critical event
  for (const id of log.ids) {
    if (excess > 0 && !needsAttention(log.byId[id]!)) {
      delete byId[id];
      excess--;
      dropped++;
    } else {
      keep.push(id);
    }
  }
  return { ...log, ids: keep, byId, dropped: log.dropped + dropped };
}
