# 0004: One simulated world, with a server door and an in-page door

Status: accepted

## Context

GitHub Pages cannot run a server, but the interesting part of this app is how it behaves against one. I wanted a public demo
that anyone can open, and also a way to run and test the app against something that speaks HTTP and a websocket.

## Decision

- `shared/world.ts` is the deployment: its devices, its numbered events, who may sign in, who may acknowledge. It is plain
  code with an injected clock, and a seeded generator makes the same events every time.
- The mock server (`server/app.ts`) wraps it in HTTP, cookie sign-in (HttpOnly, SameSite=Lax), and a websocket.
- The demo wraps the same `World` in function calls (`createDemoApi`) and an in-page socket (`createDemoSocketFactory`) that
  follow the same rules: hello, wait to be asked, replay, then live.
- The app talks to an `Api` interface and a `SocketFactory`. It does not know which it has.
- Everything about the rules (a viewer cannot acknowledge, the first acknowledgement wins) lives in `World`, so the demo
  cannot behave differently from the server.

## Consequences

- The public demo is honest about being a simulation (the Diagnostics page says so), and it exercises the same engine,
  stores and screens as the server build.
- The end-to-end suite runs every journey twice, once per door, and one check only the server build can answer: that the
  page really opens a websocket and cannot read its own sign-in cookie.
- The demo's connection never drops by itself. "Cut the connection" on the Diagnostics page does it on demand.
