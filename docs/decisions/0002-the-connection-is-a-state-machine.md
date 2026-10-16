# 0002: The connection is a state machine, and the sockets are outside it

Status: accepted

## Context

A live connection fails in several ways: it never opens, it opens and drops at once, it drops after a long time, and it
stays "open" while nothing arrives. Each needs a different answer, and the answers are easy to get subtly wrong when they are
tangled up with timers and sockets.

## Decision

- `src/domain/connection.ts` is a pure function: given the state and something that happened, it returns the new state and
  a list of things to do (connect, wait so long, close the socket). It has no timers and opens nothing.
- Retrying waits twice as long each time up to a ceiling, with "full jitter" (a random point below the ceiling), so many
  clients that lost the server together do not return together (`backoff.ts`).
- A connection that held for ten seconds counts as having worked, so the next failure starts the waits again from short. One
  that opens and drops straight away is flapping, and the waits keep growing.
- A connection that has said nothing for 2.5 heartbeats is treated as dead and closed by hand, because a browser can
  report a dead connection as open for a long time.
- `src/net/sync.ts` is the only place with timers and sockets. It runs the effects, and ignores anything that arrives from a
  socket it has already given up on (each socket has a generation number).

## Consequences

- Every path is tested without waiting: the state machine with plain function calls (including a property test that the
  waits stay within bounds), the engine with fake timers and a fake socket that the test controls.
- The same engine runs against a real websocket in the integration tests and against the in-page demo in the browser.
- The 2.5 multiplier and the ten seconds are my choices, not measured. They are named constants and the tests pin them.
