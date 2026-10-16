# 0001: One contract, written once, checked at every edge

Status: accepted

## Context

The app, the mock server and the tests all need to agree on what an event is, what the stream can say and what each REST call
returns. Written three times, those drift, and the first sign is a screen that shows `undefined`.

## Decision

- `shared/protocol.ts` holds Zod schemas for every message and response, and TypeScript types are inferred from them, never
  written beside them.
- Everything that crosses the edge is parsed, not cast: the HTTP client checks each response, and the stream parser turns
  text into a message or a reason it could not (`parseServerMessage` never throws). A bad message is logged and ignored; it
  cannot reach the store.
- The server parses what it receives with the same schemas, and checks query parameters itself (whole numbers, in range).

## Consequences

- A change to the contract is one edit, and the type checker finds every place it matters.
- A server that sends something unexpected shows up as an `invalid_response` error or a log line, not a half-rendered page.
- Parsing every event costs a little time. At the rates here (about one event a second, and a page of a few hundred when
  catching up) it is not measurable.
