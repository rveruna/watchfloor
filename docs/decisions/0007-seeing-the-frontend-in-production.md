# 0007: Seeing the frontend: logs, measures and errors

Status: accepted

## Context

When something goes wrong in a person's browser, the only evidence is what the page recorded. A console message nobody sees
is not evidence.

## Decision

- A small structured logger (`telemetry/logger.ts`) keeps the last 200 entries as data (time, level, message, context) and can
  also send each to a sink. The sync engine logs every connection change, every hole it fetches, every refusal.
- Errors nobody caught (a component that threw, a promise nobody awaited, an error the page raised) go to the same log.
- Web Vitals (LCP, INP, CLS, FCP, TTFB) are measured with the `web-vitals` library, loaded separately so it never delays the
  first paint.
- The Diagnostics page shows the connection, the measures and the log, and a button that cuts the connection so the recovery
  can be watched.

## Consequences

- A bug report can include the log. Nothing here is sent anywhere: there is no collector in this project. Pointing the logger's
  sink at one is a few lines, but I have not built or tested that.
- The numbers on the Diagnostics page are from the visitor's own browser, so they say nothing about how the app performs
  generally. I have not run a Lighthouse or load test against it.
