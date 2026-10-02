---
adr: 1
title: Reboot as Höyry on Canvas 2D, the Räkkä architecture
date: 2026-10-02
status: Accepted
deciders: Vesa
---

## Context

Sceggle ran on three.js through React Three Fiber, with Miniplex for the ECS
and rot.js for maps and RNG. After 60 commits the game was a slow sneak
across one field with boxes and capsules for art, and it was not fun. The
stack also cost the tooling: R3F's `useFrame` does not tick under headless
Chromium, so no screenshot or browser check could see the sim run.

Räkkä, built next to it on Canvas 2D with plain arrays and a headless fixed
step sim, reached a game people replay in about 50 commits, with a bot that
drives the real sim for checks and balance, and phone screenshots from a
script.

The new design (`docs/design.md`) is a top-down twin-stick shooter: tens of
enemies and a few hundred bullets on a flat arena. That is a 2D problem.

## Decision

Rebuild the game as Höyry on the Räkkä architecture: Vite, TypeScript,
React for menus and HUD only, Canvas 2D for the game with sprites drawn by
code and cached, plain arrays and a uniform grid, a mulberry32 seeded RNG,
`DT = 1/60`, nothing under `src/game/` touches the DOM.

Remove three.js, @react-three/fiber, drei, Miniplex and rot.js. Delete
`legacy/` (the 2016 stack.gl code) and the old `src/`. Git history keeps
both.

## Consequences

- The ECS rules in the old `CLAUDE.md` (components, one combat system over
  ECS queries) go. The rule that player and enemies share one attack path
  stays, as plain functions.
- Lighting and the 3D shadows are gone. The look has to come from the
  sprites, the palette and effects drawn in 2D.
- Code can be copied from Räkkä (input sticks, i18n, audio synth, version
  check, screenshot script) where it fits, so the two games drift apart
  over time as copies, not a shared library. That is accepted: a shared
  package for two hobby games costs more than it saves.
- Old seeds do not replay. There are no saved records to migrate.
