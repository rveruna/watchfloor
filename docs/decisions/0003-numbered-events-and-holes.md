# 0003: Numbered events, holes, and what is never thrown away

Status: accepted

## Context

When a connection drops, events keep happening. On reconnecting, the app must show the ones it missed, once each, in
order, and must notice if it ever skips some without being told.

## Decision

- The server numbers events 1, 2, 3, with no gaps. The app remembers the highest number it has seen and the highest with
  nothing missing before it.
- A number that skips ahead is a hole, and the engine fetches exactly the missing range over REST while the stream carries
  on. Fetches go one at a time; a second hole that appears meanwhile is merged into the next fetch.
- On reconnecting the app first catches up over REST from its last complete number, and only then asks the stream for
  everything after the highest number it holds. The server replays from that number, so nothing falls between the two.
- Events arrive in any order and any number of times. `eventLog.ts` ignores repeats, puts late ones where they belong and
  closes the hole when the last missing one arrives. A property test shuffles up to 40 events, repeats some, and checks
  the result is always the same log with no hole.
- The log holds at most 2,000 events and lets go of the oldest first, except an alarm nobody has acknowledged, which is
  never dropped. Something let go is not taken back if it is fetched again.
- The first event the app ever sees sets the starting point, so history before it is not counted as missing.

## Consequences

- Reconnecting costs one small request for what was missed, not a reload.
- Because unacknowledged alarms are kept, a flood of ordinary events cannot push an alarm off the list. The cost is that the
  log can hold more than 2,000 events if there are many open alarms.
- The "first event sets the start" rule means events older than the first one seen are ignored. The app avoids that by
  always loading a page of recent events before it listens to the stream.
