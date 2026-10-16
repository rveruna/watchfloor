# 0005: The shape of the code is enforced, not described

Status: accepted

## Context

A layering diagram in a README is out of date the first time someone is in a hurry. What keeps a codebase workable for a
team is that the wrong import fails the build.

## Decision

`npm run arch` runs dependency-cruiser over the code and CI fails on any of these:

- `shared/` imports nothing of the app or the server.
- `src/domain/` imports no Vue, Pinia, router, network, store or screen code.
- `src/net/` knows nothing of Vue, stores or screens.
- Stores do not import components or views; components and views do not reach into `src/net/` except for types.
- The server imports `shared/`, never `src/`.
- No circular imports.

## Consequences

- I checked each rule by adding the forbidden import and watching the check fail. Five of the eight rules were exercised that way (the domain, network, store, shared and server rules);
  the circular-import rule, the domain-frameworks rule and the "components do not reach the network" rule were written but not exercised.
- Moving a file or adding a layer means changing the rules in `.dependency-cruiser.cjs`, which is a visible, reviewable change.
- The rules describe how this project is organised. They are not a claim that it is the best way to organise one.
