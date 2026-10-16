import { describe, expect, it } from 'vitest';
import { STABLE_AFTER_MS, transition, type ConnectionState } from './connection';

const full = () => 0.999999;
const idle: ConnectionState = { status: 'idle' };
const open = (since = 0, attempt = 0): ConnectionState => ({ status: 'open', since, attempt });

describe('connecting', () => {
  it('starts by connecting', () => {
    expect(transition(idle, { type: 'start' }, full)).toEqual({
      state: { status: 'connecting', attempt: 0 },
      effects: [{ type: 'connect' }],
    });
  });

  it('does not start twice', () => {
    const s: ConnectionState = { status: 'connecting', attempt: 0 };
    expect(transition(s, { type: 'start' }, full).effects).toEqual([]);
    expect(transition(open(), { type: 'start' }, full).effects).toEqual([]);
  });

  it('can be started again after it was stopped', () => {
    expect(transition({ status: 'stopped' }, { type: 'start' }, full).state).toEqual({
      status: 'connecting',
      attempt: 0,
    });
  });

  it('is open once the socket says so', () => {
    expect(
      transition({ status: 'connecting', attempt: 2 }, { type: 'opened', now: 100 }, full).state,
    ).toEqual(open(100, 2));
  });

  it('ignores an open that arrives when it was not connecting', () => {
    expect(transition(idle, { type: 'opened', now: 1 }, full).state).toBe(idle);
  });
});

describe('losing the connection', () => {
  it('waits, then connects again', () => {
    const lost = transition(open(0, 0), { type: 'closed', now: 5_000 }, full);
    expect(lost.state).toMatchObject({ status: 'waiting', attempt: 1 });
    expect(lost.effects).toEqual([{ type: 'wait', ms: 499 }]);
    const again = transition(lost.state, { type: 'retry-due' }, full);
    expect(again.state).toEqual({ status: 'connecting', attempt: 1 });
    expect(again.effects).toEqual([{ type: 'connect' }]);
  });

  it('waits longer after each failure to connect', () => {
    let state: ConnectionState = { status: 'connecting', attempt: 0 };
    const waits: number[] = [];
    for (let i = 0; i < 4; i++) {
      const lost = transition(state, { type: 'closed', now: 0 }, full);
      waits.push((lost.effects[0] as { ms: number }).ms);
      state = transition(lost.state, { type: 'retry-due' }, full).state;
    }
    expect(waits).toEqual([499, 999, 1999, 3999]);
  });

  it('starts the waits again from the beginning if the connection held for a while', () => {
    const state = open(0, 5);
    const lost = transition(state, { type: 'closed', now: STABLE_AFTER_MS }, full);
    expect(lost.state).toMatchObject({ status: 'waiting', attempt: 1 });
  });

  it('keeps growing the waits if it opened and dropped straight away', () => {
    const lost = transition(open(0, 3), { type: 'closed', now: 500 }, full);
    expect(lost.state).toMatchObject({ status: 'waiting', attempt: 4 });
  });

  it('closes the socket by hand, then waits, when the connection has gone silent', () => {
    const silent = transition(open(0, 0), { type: 'silent', now: 40_000 }, full);
    expect(silent.effects).toEqual([{ type: 'close-socket' }, { type: 'wait', ms: 499 }]);
    expect(silent.state.status).toBe('waiting');
  });

  it('does not schedule a second wait if the socket then reports closing', () => {
    const silent = transition(open(0, 0), { type: 'silent', now: 40_000 }, full);
    expect(transition(silent.state, { type: 'closed', now: 40_001 }, full).effects).toEqual([]);
  });

  it('ignores a retry that is not due', () => {
    expect(transition(open(), { type: 'retry-due' }, full).effects).toEqual([]);
  });
});

describe('stopping', () => {
  it('closes an open socket', () => {
    expect(transition(open(), { type: 'stop' }, full)).toEqual({
      state: { status: 'stopped' },
      effects: [{ type: 'close-socket' }],
    });
  });

  it('closes a socket that is still connecting', () => {
    expect(transition({ status: 'connecting', attempt: 0 }, { type: 'stop' }, full).effects).toEqual([
      { type: 'close-socket' },
    ]);
  });

  it('has no socket to close while waiting or idle', () => {
    expect(transition({ status: 'waiting', attempt: 1, retryAt: 9 }, { type: 'stop' }, full).effects).toEqual(
      [],
    );
    expect(transition(idle, { type: 'stop' }, full).effects).toEqual([]);
  });

  it('stays stopped, and a close that arrives afterwards does not bring it back', () => {
    const stopped: ConnectionState = { status: 'stopped' };
    expect(transition(stopped, { type: 'stop' }, full).effects).toEqual([]);
    expect(transition(stopped, { type: 'closed', now: 1 }, full).state).toBe(stopped);
    expect(transition(stopped, { type: 'retry-due' }, full).state).toBe(stopped);
  });
});
