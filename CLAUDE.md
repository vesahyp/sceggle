# CLAUDE.md

Guidance for AI agents working in this repo.

## What this is

**sceggle** is a top-down 3D roguelike (web). It began as a 2016 stack.gl
scene-graph experiment (preserved under `legacy/`, do not build on it) and was
rebooted onto a modern stack. See `README.md` for the pitch and `ROADMAP.md`
for what to build next.

## Stack

- **Vite + TypeScript + React** — build/dev and app shell.
- **three.js** via **@react-three/fiber** (R3F) — rendering. `drei` for helpers.
- **Rapier** via **@react-three/rapier** — physics (knockback, collisions).
- **Miniplex** — ECS; the game's entity/component model.
- **rot.js** — dungeon generation, FOV, pathfinding, seeded RNG.

## Where things live

```
src/
  ecs.ts        Miniplex world + the Entity type (the component vocabulary)
  weapons.ts    Weapon data
  dungeon.ts    rot.js map generation → grid + walkable cells
  systems.ts    Game logic operating over ECS queries (e.g. combat)
  input.ts      Keyboard: held state + edge-triggered presses
  scene/        R3F render components (Dungeon, Player, Mob, Weapon)
  App.tsx       Wires scene, HUD, input together
legacy/         Original 2016 code — reference only, don't extend
```

## Architecture rules (follow these)

1. **ECS is the source of truth.** Game state = components on entities in
   `world` (`src/ecs.ts`). To add a capability, add a field to `Entity` and a
   system that reads it — don't subclass.
2. **Renderer reflects state; it doesn't own it.** three.js/React render from
   the ECS. Physics handles are published to entities via `entity.rb`.
3. **Hot loop is imperative.** Per-frame movement/physics run in `useFrame`
   mutating refs. Never drive per-frame simulation through React state.
4. **Structure/UI is declarative.** Spawning, equipment, and HUD are React —
   e.g. swapping a weapon is a prop/component change, meshes mount/dispose.
5. **Determinism.** All randomness goes through rot.js's seeded RNG. Same seed
   must reproduce the same run.

## Workflow

- Dev: `npm run dev` (http://localhost:5173).
- **Verify before committing:** `npm run typecheck` and `npm run build` must
  pass. When practical, smoke-test the runtime (load the dev server in a
  headless browser and confirm the canvas mounts with no console errors) —
  a green build doesn't prove the scene renders.
- Keep changes scoped to one roadmap item per PR. Update `ROADMAP.md`
  (check off / move to Done) as part of the change.
- Placeholders (capsules, boxes) are intentional; don't gold-plate visuals
  unless that's the task.
