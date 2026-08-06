# CLAUDE.md

Guidance for AI agents working in this repo.

## What this is

**sceggle** is a top-down 3D hack-slash-loot (web). It began as a 2016 stack.gl
scene-graph experiment (preserved under `legacy/`, do not build on it) and was
rebooted onto a modern stack. See `README.md` for the pitch and `ROADMAP.md`
for what to build next.

## Stack

- **Vite + TypeScript + React** — build/dev and app shell.
- **three.js** via **@react-three/fiber** (R3F) — rendering. `drei` for helpers.
- **Movement/collision** — bespoke kinematic sim (`src/systems.ts` +
  `src/worldmap.ts`, circle-vs-grid). There is deliberately **no physics
  engine**; do not reintroduce one.
- **Miniplex** — ECS; the game's entity/component model.
- **rot.js** — map generation, pathfinding, seeded RNG.

## Where things live

```
src/
  ecs.ts        Miniplex world + the Entity type (the component vocabulary)
  rng.ts        Seeding the shared rot.js stream (hash + warm-up; seed here,
                never ROT.RNG.setSeed directly)
  weapons.ts    Point-budget weapon generation (no hardcoded weapons)
  worldmap.ts   Overworld generation — open ground with rolled layout
                archetypes + an arena spine — and circle-vs-grid collision
  systems.ts    Simulation tick over ECS queries: perception, AI, movement,
                shared melee swings + projectiles, loot, area exit
  utility.ts    Mob decision-making: intents score themselves from world facts
                weighted by per-mob traits, highest wins (no RNG, no ECS)
  steering.ts   Context steering: desires vote on a ring of headings, terrain
                and bodies veto, votes resolve into one direction
  flowfield.ts  One Dijkstra expansion from the player; every mob samples the
                gradient instead of running its own A*
  events.ts     One-way sim → React bridge (deaths, pickups, damage, exit)
  input.ts      Keyboard: held state + edge-triggered presses (ignores form fields)
  characters.ts Character archetypes — preset spends of one point budget +
                the seeded starter-gun roll
  scene/        R3F render components (Terrain, Player, Mob, Weapon, HealthBar,
                Projectiles, Loot, DamageNumbers, Vision, Simulation)
  Game.tsx      One run: areas, mob spawning (point pools), HUD strip, the
                pause overlay (pack + help); wires scene + input
  Menu.tsx      Title screen, character/seed select, in-run pause overlay
  App.tsx       Shell state machine: title ↔ select ↔ game; owns pause
tools/
  sim-check.ts  `npm run sim-check` — behavioural checks against the real sim
public/         tracker.js + t.gif — self-hosted analytics (see TRACKING.md)
infra/          Terraform: CloudFront pixel host / future site host
legacy/         Original 2016 code — reference only, don't extend
```

## Architecture rules (follow these)

1. **ECS is the source of truth.** Game state = components on entities in
   `world` (`src/ecs.ts`). To add a capability, add a field to `Entity` and a
   system that reads it — don't subclass.
2. **Renderer reflects state; it doesn't own it.** three.js/React render from
   the ECS. Sim state lives in `pos`/`vel` components; scene components copy
   `pos` into meshes each frame.
3. **Hot loop is imperative.** The sim tick and per-frame movement run in
   `useFrame` mutating refs. Never drive per-frame simulation through React
   state.
4. **Structure/UI is declarative.** Spawning, equipment, and HUD are React —
   e.g. swapping a weapon is a prop/component change, meshes mount/dispose.
5. **Determinism.** All randomness goes through rot.js's seeded RNG. Same seed
   must reproduce the same run.
6. **Generated, not authored.** Content (weapons, mobs) rolls from seeded
   point budgets — never add hardcoded rosters. Remaining constants are
   placeholders to be swept into generation (see ROADMAP).
7. **One combat system.** Player and mobs share the same attack code paths
   (`advanceAttack`, the projectile pipeline). Never fork a mob-only or
   player-only variant of a mechanic; differ by stats and target side only.

## Workflow

- Dev: `npm run dev` (http://localhost:5173).
- **Verify before committing:** `npm run typecheck` and `npm run build` must
  pass. If you touched the sim (`systems.ts`, `worldmap.ts`, `flowfield.ts`,
  `steering.ts`, `ecs.ts`), `npm run sim-check` must pass too — it drives the
  real `stepSimulation` headlessly over a generated map and asserts on
  behaviour (mobs path, hold their range, surround, remember, forget, and
  replay identically for a seed). Add a case there when you add a mechanic.
- Smoke-testing in a browser is worth doing when you touched the *view*, but
  note it can't check the sim: R3F's `useFrame` does not run under headless
  Chromium in the CI/agent sandbox, so the canvas mounts clean while nothing
  ticks. Treat "no console errors" as evidence about rendering only.
- Keep changes scoped to one roadmap item per PR. Delete the item from
  `ROADMAP.md` as part of the change — don't archive it in a "Done" section.
  `ROADMAP.md` is forward-looking only; git history is the record of what
  shipped, and duplicating it there just creates a second copy that rots.
- Placeholders (capsules, boxes) are intentional; don't gold-plate visuals
  unless that's the task.
