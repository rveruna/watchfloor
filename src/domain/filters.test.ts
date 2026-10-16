import { describe, expect, it } from 'vitest';
import { alarm, event } from '@/test/factories';
import { applyEvent, emptyLog, mergeEvents } from './eventLog';
import { defaultFilter, filterEvents, summarise } from './filters';

const log = mergeEvents(emptyLog(), [
  event(1),
  event(2, { severity: 'warning', deviceId: 'door-front', message: 'Front door opened' }),
  alarm(3),
  event(4, { deviceId: 'cam-yard', message: 'Motion detected on Yard camera' }),
  alarm(5, { ack: { by: 'Operator', at: 't' } }),
]).log;

const names = { 'door-front': 'Front door', 'cam-yard': 'Yard camera', 'cam-lobby': 'Lobby camera' };

describe('filterEvents', () => {
  it('returns everything, newest first, with the default filter', () => {
    expect(filterEvents(log, defaultFilter()).map((e) => e.seq)).toEqual([5, 4, 3, 2, 1]);
  });

  it('filters by severity', () => {
    const only = { ...defaultFilter(), severities: new Set(['critical'] as const) };
    expect(filterEvents(log, only).map((e) => e.seq)).toEqual([5, 3]);
  });

  it('filters by device', () => {
    expect(filterEvents(log, { ...defaultFilter(), deviceId: 'cam-yard' }).map((e) => e.seq)).toEqual([4]);
  });

  it('filters by words in the message or the device name, ignoring case and spaces at the ends', () => {
    expect(filterEvents(log, { ...defaultFilter(), text: '  YARD ' }, names).map((e) => e.seq)).toEqual([4]);
    expect(filterEvents(log, { ...defaultFilter(), text: 'lobby' }, names).map((e) => e.seq)).toEqual([1]);
  });

  it('can show only what still needs someone', () => {
    expect(filterEvents(log, { ...defaultFilter(), unacknowledgedOnly: true }).map((e) => e.seq)).toEqual([
      3, 2,
    ]);
  });

  it('combines the filters', () => {
    expect(
      filterEvents(log, { ...defaultFilter(), deviceId: 'door-front', unacknowledgedOnly: true }).map(
        (e) => e.seq,
      ),
    ).toEqual([3, 2]);
  });

  it('returns nothing for an empty log', () => {
    expect(filterEvents(emptyLog(), defaultFilter())).toEqual([]);
  });
});

describe('summarise', () => {
  it('counts events at each severity and the alarms still waiting', () => {
    expect(summarise(log)).toEqual({
      total: 5,
      bySeverity: { info: 2, warning: 1, critical: 2 },
      unacknowledgedCritical: 1,
    });
  });

  it('is all zeros for nothing', () => {
    expect(summarise(applyEvent(emptyLog(), event(1)).log).unacknowledgedCritical).toBe(0);
  });
});
