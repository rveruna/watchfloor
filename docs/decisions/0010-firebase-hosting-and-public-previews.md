# 0010: Firebase Hosting, and a public preview for every pull request

Status: accepted

## Context

I wanted every pull request to have a link a reviewer can open and click through, and I wanted the demo to behave properly for
deep links. GitHub Pages cannot do either well: it has no previews, and it answers an address inside the app with a 404
status (the page still loads, but browsers and tools see an error). Vercel previews work, but they sit behind Vercel's own
login by default, so a recruiter or a colleague cannot open one.

## Decision

- The in-page demo is also published to **Firebase Hosting** (`watchfloor-rveruna.web.app`), with one rewrite to `index.html`,
  so a deep link such as `/devices` answers 200. Hashed assets are cached for a year.
- **A GitHub Action** (`firebase-hosting-pull-request.yml`) builds each pull request and publishes it to a Hosting preview
  channel that lasts 14 days. The link is posted on the pull request, and it is public. A second workflow updates the live
  site when `main` changes.
- The pull request workflow skips forks and Dependabot, which cannot read the deploy key.
- **The deploy key is a service account with only what deploying needs**: Firebase Hosting Admin, API Keys Viewer and Cloud Run
  Viewer, stored as a repository secret. It was created with the Google Cloud APIs because the Firebase tool's own
  `init hosting:github` can only ask its questions in a terminal.
- Hosting serves the demo build, not the server build: a Firebase Hosting site cannot proxy `/api` to Vercel, and cookies
  would not cross between the two addresses.

## Consequences

- There are now four ways to see the app: the Pages demo, the Firebase demo, the Vercel server and local. They are the same code.
  That is more than a project this size needs, and it is deliberate: each deployment shows a different thing (Pages is the
  simplest, Firebase has previews, Vercel runs the real server), and a change has to keep all of them working.
- A service account key does not expire. If the repository were compromised, the key could deploy to this one Hosting site and
  nothing else, and it can be deleted in the Google Cloud console. A keyless set-up (workload identity federation) would be
  better and I did not build it.
- I have not used Firebase Auth, Firestore, Remote Config or Analytics (see [0008](0008-what-is-and-is-not-here.md)). What I
  can honestly say I have done with Firebase is host and deploy with it, in CI, with previews.
