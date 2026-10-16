# 0006: A page that changes by itself, made usable

Status: accepted

## Context

A page that updates itself is hard to use with a screen reader, a keyboard or a small screen, and in an alarm context a
screen that is wrong for a moment is worse than one that is slow.

## Decision

- **A new alarm is announced, and only alarms.** A polite live region says "New alarm: ..." for a critical event that arrives
  live. Ordinary events are not announced, and announcements are at least four seconds apart so a burst is heard as one.
- **No false reassurance.** Until the first events have arrived, the page says "Loading alarms..." and the summary shows
  dashes. It never says "Nothing needs anyone right now" or "0 alarms" as a guess. The end-to-end run found a race where it
  did, which is why this exists.
- **Severity is never only colour.** Each level has a word and a shape (circle, triangle, diamond), and device status has a
  word as well as a shape.
- **The connection is a status, in words.** "Live", "Connection lost. Retrying (attempt 3)...".
- **Only the newest 100 events are drawn**, with a button for the next 100, so the page stays fast and the list stays a
  list a person can move through.
- **Tables that can be wider than the screen scroll inside a labelled, focusable region**, not the page.
- Acknowledging updates the screen at once and takes it back, with a message, if the server refuses.

## Consequences

- Axe (WCAG 2.2 AA and best-practice rules) finds nothing on any page in the browser, at four widths, in both modes. Axe cannot
  judge whether the announcements are pleasant to listen to. **I have not tested with a screen reader.**
- The four-second gap is a guess at "not a flood", not something I measured with users.
