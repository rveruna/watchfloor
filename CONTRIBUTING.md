# Contributing

This is a small project, written to be read. If you are new to it, start here.

## The five-minute tour

1. `shared/protocol.ts`: what an event is and what the stream can say. Everything else follows from it.
2. `src/domain/`: the rules, as pure functions. `eventLog.ts`, `connection.ts`, `backoff.ts`. Start with their tests.
3. `src/net/sync.ts`: the one place with sockets and timers. Read it with `sync.test.ts` open.
4. `src/stores/`: Pinia stores that hold what the screens show.
5. `src/components/` and `src/views/`: the screens.
6. `shared/world.ts`: the simulated deployment that the server and the demo both run.

## Run it

```bash
npm install
npm run dev               # the demo, in your browser, no server needed
npm run dev:all           # the app against the mock server (HTTP and a websocket)
npm test                  # unit, store, component and server tests
npm run e2e               # needs `npm run build:e2e` first, and Chrome or `npx playwright install chromium`
E2E_URL=https://your-deployment npm run e2e   # the same journeys against something already running
```

Sign in as `operator@example.com` / `operator` (can acknowledge alarms) or `viewer@example.com` / `viewer`.

## Deploys

Pushing to `main` publishes the in-page demo to GitHub Pages and to Firebase Hosting (both GitHub Actions) and the real server to
Vercel, which watches the repository. Every pull request gets a public Firebase preview of the demo (a link is posted on the
pull request) and a Vercel preview of the real server, which is behind Vercel's own login by default.

## What a change needs

- A test that fails without it. If the change is a bug fix, the test should fail on the old code first.
- `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run arch` and `npm test` all pass. CI runs them, plus the
  browser checks.
- If it changes the shape of the code, change the rule in `.dependency-cruiser.cjs` in the same commit, so the change is visible.
- If it was not obvious, a short decision record in `docs/decisions/`.

## Reviewing

Look for what a test cannot: whether a name says what the thing is, whether a comment says why and not what, whether an error
message would help someone who has never seen the code, and whether a screen reader user would be told what a sighted user
is shown.
