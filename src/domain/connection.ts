import { backoffDelay, type BackoffOptions, DEFAULT_BACKOFF } from './backoff';

/**
 * The life of the connection as a state machine. It does nothing itself: given the state and something that happened, it
 * says what the state is now and what to do about it. Timers and sockets live elsewhere, so every path through here
 * can be tested without waiting or opening anything.
 */

/** A connection that stays open this long counts as having worked, so the next failure starts the waits from the beginning. */
export const STABLE_AFTER_MS = 10_000;

export type ConnectionState =
  | { status: 'idle' }
  /** `attempt` is how many attempts in a row have failed so far. */
  | { status: 'connecting'; attempt: number }
  | { status: 'open'; since: number; attempt: number }
  | { status: 'waiting'; attempt: number; retryAt: number }
  | { status: 'stopped' };

export type ConnectionEvent =
  | { type: 'start' }
  | { type: 'opened'; now: number }
  /** The socket closed or failed to open. */
  | { type: 'closed'; now: number }
  /** Nothing was heard for too long, so the connection is treated as dead even though nothing said so. */
  | { type: 'silent'; now: number }
  | { type: 'retry-due' }
  | { type: 'stop' };

export type ConnectionEffect = { type: 'connect' } | { type: 'wait'; ms: number } | { type: 'close-socket' };

export interface Step {
  state: ConnectionState;
  effects: ConnectionEffect[];
}

export function transition(
  state: ConnectionState,
  event: ConnectionEvent,
  random: () => number,
  backoff: BackoffOptions = DEFAULT_BACKOFF,
): Step {
  const stay: Step = { state, effects: [] };

  switch (event.type) {
    case 'start':
      if (state.status === 'idle' || state.status === 'stopped') {
        return { state: { status: 'connecting', attempt: 0 }, effects: [{ type: 'connect' }] };
      }
      return stay;

    case 'opened':
      if (state.status !== 'connecting') return stay;
      return { state: { status: 'open', since: event.now, attempt: state.attempt }, effects: [] };

    case 'closed':
    case 'silent': {
      if (state.status !== 'connecting' && state.status !== 'open') return stay;
      const failures = failuresAfter(state, event.now);
      const ms = backoffDelay(failures, random, backoff);
      return {
        state: { status: 'waiting', attempt: failures, retryAt: event.now + ms },
        // a connection gone quiet is still open as far as the browser knows, so it has to be closed by hand
        effects:
          event.type === 'silent' ? [{ type: 'close-socket' }, { type: 'wait', ms }] : [{ type: 'wait', ms }],
      };
    }

    case 'retry-due':
      if (state.status !== 'waiting') return stay;
      return { state: { status: 'connecting', attempt: state.attempt }, effects: [{ type: 'connect' }] };

    case 'stop':
      if (state.status === 'stopped') return stay;
      return {
        state: { status: 'stopped' },
        effects: state.status === 'connecting' || state.status === 'open' ? [{ type: 'close-socket' }] : [],
      };
  }
}

function failuresAfter(
  state: Extract<ConnectionState, { status: 'connecting' | 'open' }>,
  now: number,
): number {
  if (state.status === 'connecting') return state.attempt + 1;
  // it opened: if it held for a while the run of failures is over, otherwise it is flapping and the waits keep growing
  return now - state.since >= STABLE_AFTER_MS ? 1 : state.attempt + 1;
}
