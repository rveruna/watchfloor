import { describe, expect, it, vi } from 'vitest';
import { createLogger } from './logger';

describe('createLogger', () => {
  it('keeps entries as data, with the time, level, message and context', () => {
    let t = 1000;
    const log = createLogger({ now: () => t++ });
    log.info('connected', { attempt: 2 });
    log.error('boom');
    expect(log.entries()).toEqual([
      { at: 1000, level: 'info', message: 'connected', context: { attempt: 2 } },
      { at: 1001, level: 'error', message: 'boom' },
    ]);
  });

  it('has all four levels', () => {
    const log = createLogger();
    log.debug('a');
    log.info('b');
    log.warn('c');
    log.error('d');
    expect(log.entries().map((e) => e.level)).toEqual(['debug', 'info', 'warn', 'error']);
  });

  it('forgets the oldest entries beyond its capacity', () => {
    const log = createLogger({ capacity: 3 });
    for (let i = 1; i <= 5; i++) log.info(`m${i}`);
    expect(log.entries().map((e) => e.message)).toEqual(['m3', 'm4', 'm5']);
  });

  it('hands back a copy, so nobody can change its history', () => {
    const log = createLogger();
    log.info('a');
    log.entries().pop();
    expect(log.entries()).toHaveLength(1);
  });

  it('sends each entry to a sink and to listeners until they stop', () => {
    const sink = vi.fn();
    const listener = vi.fn();
    const log = createLogger({ sink });
    const stop = log.subscribe(listener);
    log.info('one');
    stop();
    log.info('two');
    expect(sink).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
