# 0008: What is and is not here

Status: accepted

## What the evidence is

| Check                                                                                     | Where           |
| ----------------------------------------------------------------------------------------- | --------------- |
| Unit, store, component and server tests, including real HTTP and real websockets          | every push (CI) |
| Property tests: the event log whatever the order, the retry waits within bounds           | every push (CI) |
| Architecture rules (dependency-cruiser)                                                   | every push (CI) |
| Browser run of every journey in both modes, with axe at four widths                       | every push (CI) |
| Hand-made mutants of the log, state machine, engine, client, world and server: all caught | once, locally   |

## What is not here

- **It is not wired to any real product.** All the data is invented and every event comes from a seeded generator. No real
  camera, video or alarm panel is involved, and the project has no connection to any company's product or API.
- **Firebase is used for Hosting and deploys only.** There is no Firebase Auth, Firestore, Remote Config or Analytics: sign-in
  is a cookie against the server, events are generated, and the logger and Web Vitals stay in the page. I planned Auth against the
  emulators, but anything built on them could not run in a public demo. See [0010](0010-firebase-hosting-and-public-previews.md).
- **No Go backend, no database.** The server is a few hundred lines of Node and keeps everything in memory.
- **No screen reader testing** (VoiceOver, NVDA), and no real-device testing. Axe and a keyboard run are what has been done.
- **No load testing.** The list draws 100 rows and the log holds 2,000 events; I have not tried a stream of thousands a second.
- **Two deployments, one fully simulated.** GitHub Pages runs the in-page demo. Vercel runs the real server code (HTTP and a
  websocket, see [0009](0009-running-on-vercel-without-shared-memory.md)), but its events are still invented and its
  acknowledgements live in an ephemeral cache.
