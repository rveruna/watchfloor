# 0009: Running on Vercel, where copies of the server share no memory

Status: accepted

## Context

The mock server keeps everything in one process: the events, who is signed in, who acknowledged what. On Vercel the same code
runs as several copies at once, and [the docs are plain](https://vercel.com/guides/do-vercel-serverless-functions-support-websocket-connections)
that in-memory variables are visible only to connections on the same copy. A page's REST calls and its websocket can land on
different copies, and so can a reconnect. Run unchanged, two copies would disagree about what had happened and who had signed in.
Websocket functions are also a public beta, and each connection is closed after the function's maximum duration (5 minutes
here).

## Decision

- **The server is split** into a core (routes, websocket, cookies) and a `Deployment` plus `Sessions` it is given. The mock
  server passes one `World` in memory; the Vercel build passes the clock-driven versions below. The browser app is unchanged.
- **Events follow from the clock.** `server/clockDeployment.ts` makes the same events on every copy: they are a pure function of
  a seed and the time, numbered from the start of the current week (UTC Monday). A copy that started a minute ago and one that
  has run all week give the same answer, and a test checks it.
- **Sessions are signed cookies** (HMAC-SHA256 over the user and an expiry, checked with a constant-time compare). Any copy that
  knows the secret can read one. The cost is that signing out only clears the cookie: a token cannot be taken back before its
  eight hours are up. The server refuses to start without `SESSION_SECRET`.
- **Acknowledgements live in the Vercel Runtime Cache**, the one place the copies in a region share. A stream polls it once a
  second and sends an `ack` message when another copy's acknowledgement appears, so a viewer connected to one copy sees an
  operator's click on another.
- **The 5-minute limit is expected, not an error.** The connection closes at about 315 seconds; the engine reconnects in about
  a second and catches up from its last complete number. I held a page open for 335 seconds on the live deployment to see this:
  the log showed one close and one reconnect, no missed events and no errors.
- **The function is `api/server.ts`**, reached by a rewrite from `/api/v1/*`. My first version used a catch-all file name and
  matched only single-segment paths on Vercel (`/api/v1/devices` worked, `/api/v1/events/latest` returned the platform's
  404), which the browser run against the live URL found. Relative imports in `server/` and `shared/` end in `.js`, because
  Vercel compiles each file separately and Node's ES module loader will not guess the extension.
- **If the server's numbering goes backwards** (as it does when the week rolls over, or after a restart), the app notices that
  the server's `hello` reports a number well below what it holds, forgets its events and loads afresh. "Well below" is 20,
  because copies with slightly different clocks can disagree by an event or two.

## Consequences

- The browser suite runs unchanged against the live deployment (`E2E_URL=... npm run e2e`): 15 checks, with axe at four
  widths, a real websocket and an HttpOnly, Secure cookie. Two in-process copies sharing only the secret, epoch and a store
  are also tested over real HTTP and websockets.
- **Acknowledgements can race.** They are kept in one cache entry with no compare-and-set, so two operators acknowledging at the
  very same moment can overwrite each other. A real deployment would use a database. The cache is also per region and evicts,
  so acknowledgements are not durable.
- **The numbering restarts every Monday**, so history is a week at most, and an open page notices and reloads. At about 2.75
  seconds per event a week is around 220,000 events, which a copy generates on start-up and holds in memory (capped at 300,000).
- **Preview URLs are behind Vercel's own login by default**, so only the production URL is public.
- Websocket functions are in beta. If the platform changes, this part may break, and the in-page demo on GitHub Pages is the
  fallback.
