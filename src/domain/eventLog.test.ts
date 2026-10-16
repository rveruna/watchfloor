import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { alarm, event } from '@/test/factories';
import {
  applyAck,
  applyEvent,
  emptyLog,
  firstGap,
  mergeEvents,
  needsAttention,
  removeAck,
  type EventLog,
} from './eventLog';

const feed = (log: EventLog, ...seqs: number[]) => seqs.reduce((l, s) => applyEvent(l, event(s)).log, log);

describe('adding events', () => {
  it('keeps them in order of sequence number', () => {
    const log = feed(emptyLog(), 1, 2, 3);
    expect(log.ids).toEqual(['evt-1', 'evt-2', 'evt-3']);
    expect(log.contiguousSeq).toBe(3);
    expect(log.highestSeq).toBe(3);
  });

  it('ignores an event it already has', () => {
    const once = applyEvent(emptyLog(), event(1));
    const twice = applyEvent(once.log, event(1));
    expect(twice.added).toBe(false);
    expect(twice.log).toBe(once.log);
  });

  it('treats the first event it ever sees as the starting point, not as a hole after nothing', () => {
    const { log, gap } = applyEvent(emptyLog(), event(4801));
    expect(gap).toBeNull();
    expect(log.contiguousSeq).toBe(4801);
  });

  it('reports a hole when a number is skipped, and says which ones', () => {
    const { gap, log } = applyEvent(feed(emptyLog(), 1, 2), event(5));
    expect(gap).toEqual({ from: 3, to: 4 });
    expect(log.contiguousSeq).toBe(2);
    expect(log.highestSeq).toBe(5);
    expect(firstGap(log)).toEqual({ from: 3, to: 4 });
  });

  it('puts a late event where it belongs and closes the hole when the last missing one turns up', () => {
    let log = feed(emptyLog(), 1, 2, 5);
    log = applyEvent(log, event(3)).log;
    expect(log.ids).toEqual(['evt-1', 'evt-2', 'evt-3', 'evt-5']);
    expect(firstGap(log)).toEqual({ from: 4, to: 4 });
    log = applyEvent(log, event(4)).log;
    expect(firstGap(log)).toBeNull();
    expect(log.contiguousSeq).toBe(5);
  });

  it('ignores an event from before the point it started at that it does not hold', () => {
    const log = feed(emptyLog(), 10, 11);
    const again = applyEvent(log, event(3));
    expect(again.added).toBe(false);
  });
});

describe('a single missing event', () => {
  it('is reported as a hole of one', () => {
    const { gap } = applyEvent(feed(emptyLog(), 1, 2), event(4));
    expect(gap).toEqual({ from: 3, to: 3 });
  });
});

describe('filling a hole from a fetched page', () => {
  it('merges the page in any order and reports no hole when it is full', () => {
    const log = feed(emptyLog(), 1, 2, 6);
    const merged = mergeEvents(log, [event(5), event(3), event(4)]);
    expect(merged.gap).toBeNull();
    expect(merged.log.ids).toEqual(['evt-1', 'evt-2', 'evt-3', 'evt-4', 'evt-5', 'evt-6']);
  });

  it('reports what is still missing if the page was short', () => {
    const merged = mergeEvents(feed(emptyLog(), 1, 2, 6), [event(3)]);
    expect(merged.gap).toEqual({ from: 4, to: 5 });
  });

  it('starts from the lowest event of the first page it is given', () => {
    const merged = mergeEvents(emptyLog(), [event(902), event(900), event(901)]);
    expect(merged.gap).toBeNull();
    expect(merged.log.contiguousSeq).toBe(902);
  });
});

describe('looking for a hole', () => {
  it('finds none if the log claims one but holds nothing to show it', () => {
    const log = { ...emptyLog(), highestSeq: 3, contiguousSeq: 1 };
    expect(firstGap(log)).toBeNull();
  });
});

describe('capacity', () => {
  it('lets go of the oldest events first', () => {
    const log = [1, 2, 3, 4, 5].reduce((l, s) => applyEvent(l, event(s), 3).log, emptyLog());
    expect(log.ids).toEqual(['evt-3', 'evt-4', 'evt-5']);
    expect(log.dropped).toBe(2);
  });

  it('never lets go of a critical event nobody has acknowledged, even if it is the oldest', () => {
    let log = applyEvent(emptyLog(), alarm(1), 2).log;
    for (const s of [2, 3, 4]) log = applyEvent(log, event(s), 2).log;
    // capacity is 2, and the alarm uses one of the places for as long as it needs someone
    expect(log.ids).toEqual(['evt-1', 'evt-4']);
  });

  it('lets it go once it has been acknowledged', () => {
    let log = applyEvent(emptyLog(), alarm(1), 2).log;
    log = applyAck(log, 'evt-1', { by: 'Operator', at: 'now' });
    for (const s of [2, 3, 4]) log = applyEvent(log, event(s), 2).log;
    expect(log.ids).toEqual(['evt-3', 'evt-4']);
  });

  it('does not take back the newest event either, if it was let go because older ones needed to stay', () => {
    let log = applyEvent(emptyLog(), alarm(1), 2).log;
    log = applyEvent(log, alarm(2), 2).log;
    log = applyEvent(log, event(3), 2).log;
    expect(log.ids).toEqual(['evt-1', 'evt-2']);
    const again = applyEvent(log, event(3), 2);
    expect(again.added).toBe(false);
    expect(again.log.ids).toEqual(['evt-1', 'evt-2']);
  });

  it('does not take back events it let go when they are fetched again', () => {
    let log = [1, 2, 3, 4, 5].reduce((l, s) => applyEvent(l, event(s), 3).log, emptyLog());
    log = applyEvent(log, event(1), 3).log;
    expect(log.ids).toEqual(['evt-3', 'evt-4', 'evt-5']);
  });
});

describe('acknowledging', () => {
  it('records who and when, and keeps the first acknowledgement', () => {
    const log = applyEvent(emptyLog(), alarm(1)).log;
    const first = applyAck(log, 'evt-1', { by: 'Operator', at: 't1' });
    const second = applyAck(first, 'evt-1', { by: 'Someone else', at: 't2' });
    expect(second.byId['evt-1']!.ack).toEqual({ by: 'Operator', at: 't1' });
    expect(second).toBe(first);
  });

  it('ignores an acknowledgement for an event it does not have', () => {
    const log = emptyLog();
    expect(applyAck(log, 'nope', { by: 'x', at: 'y' })).toBe(log);
  });

  it('can take an acknowledgement back', () => {
    const log = applyAck(applyEvent(emptyLog(), alarm(1)).log, 'evt-1', { by: 'Operator', at: 't1' });
    expect(removeAck(log, 'evt-1').byId['evt-1']!.ack).toBeUndefined();
    expect(removeAck(log, 'unknown')).toBe(log);
    const none = applyEvent(emptyLog(), alarm(1)).log;
    expect(removeAck(none, 'evt-1')).toBe(none);
  });

  it('knows which events need attention', () => {
    expect(needsAttention(alarm(1))).toBe(true);
    expect(needsAttention(alarm(1, { ack: { by: 'a', at: 'b' } }))).toBe(false);
    expect(needsAttention(event(1, { severity: 'warning' }))).toBe(false);
  });
});

describe('whatever order events arrive in', () => {
  it('ends up with the same log, with no hole, once every event has arrived at least once', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 40 }).chain((n) =>
          fc.tuple(
            fc.constant(n),
            // the first event seen sets the starting point, so start with the first one and shuffle the rest
            fc.shuffledSubarray(
              Array.from({ length: n - 1 }, (_, i) => i + 2),
              { minLength: n - 1, maxLength: n - 1 },
            ),
            fc.array(fc.integer({ min: 1, max: n }), { maxLength: 20 }),
          ),
        ),
        ([n, rest, repeats]) => {
          const log = [1, ...rest, ...repeats].reduce(
            (l, s) => applyEvent(l, event(s), 1000).log,
            emptyLog(),
          );
          expect(log.ids).toEqual(Array.from({ length: n }, (_, i) => `evt-${i + 1}`));
          expect(firstGap(log)).toBeNull();
          expect(log.highestSeq).toBe(n);
          expect(log.contiguousSeq).toBe(n);
        },
      ),
    );
  });
});
