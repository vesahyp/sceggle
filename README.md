# sceggle

A top-down hack-slash-loot — code-first, minimal, own-the-loop.

**▶ Play: https://vesahyp.github.io/sceggle/** — every merge to `master` publishes a new build via GitHub Actions.

> Reboot of a 2016 WebGL scene-graph experiment. Rather than build a renderer
> from scratch on the (now-defunct) stack.gl toolchain, this version composes a
> game from modern, maintained libraries. The original code is preserved under
> [`legacy/`](./legacy).

## Stack

| Concern | Library |
|---|---|
| Rendering / scene graph | [three.js](https://threejs.org) via [@react-three/fiber](https://docs.pmnd.rs/react-three-fiber) |
| Movement & collision | tiny in-house kinematic sim (circle-vs-grid) — no physics engine |
| Entities / composition | [Miniplex](https://github.com/hmans/miniplex) ECS |
| Map gen, pathfinding, RNG | [rot.js](https://ondras.github.io/rot.js/hp/) |
| Build / dev server | [Vite](https://vitejs.dev) + TypeScript |

## Run

```bash
npm install
npm run dev      # http://localhost:5173
```

`npm run build` type-checks and produces a production bundle.

## Controls

- **W A S D** — move · **Mouse** — aim
- **Click / Space** — attack; *hold* to keep attacking at the weapon's rate
  of fire. Melee swings an arc, ranged fires a projectile at the cursor
- Walk over a drop to equip it; step on the gold pad to leave the area
- **1** — dev: reroll the weapon in hand

Nothing is hardcoded: weapons roll from a level-based point budget (damage,
knockback, stagger, rate of fire, reach, projectile stats, pierce), and mobs
roll from their own pool (hit points, move speed, resistances, weapon
budget). Player and mobs share **one combat system**: melee is a swept
strike — the blade connects only where and when it passes, within a strike
band around its reach, so long weapons have a close-range dead zone (shown
as the hole in your gold hit-area ring) — and ranged fires projectiles
through the same pipeline (gold = yours, red = incoming).

You see 7 units (the world fades to dark beyond); mobs see 6 with line of
sight (their blue rings, shown while idle) and hear 4 through walls.
Alerted mobs glow red, face you, and attack with the weapon they hold.
Health bars float over every head, floating numbers show every hit
(gold = dealt, red = taken), and stagger/stun shows as a status label.
Dying respawns you at the area entry with full HP. Kill a mob and it drops
the exact weapon it was holding.

## How it's organized

```
src/
  ecs.ts           Miniplex world + Entity component vocabulary
  weapons.ts       Point-budget weapon generation (damage, knockback, stagger,
                   rate of fire, reach, projectile stats, pierce)
  worldmap.ts      Open-overworld generation (entry/exit) + circle-vs-grid collision
  systems.ts       Simulation tick: perception, AI, movement, combat, loot, exit
  events.ts        One-way sim → React bridge (deaths, pickups, area exit)
  input.ts         Keyboard (held state + edge-triggered presses)
  scene/           React-three-fiber render components
    Terrain.tsx    Ground slab + instanced obstacle blocks + exit pad
    Player.tsx     Input → velocity, camera follow, hit-area indicators
    Mob.tsx        Leveled mob body, alert glow, sight ring, status label
    Weapon.tsx     Held-weapon mesh — melee blade spans its true strike band
    HealthBar.tsx  Billboarded bar above every entity with health
    Projectiles.tsx  Instanced mesh mirroring projectile entities
    Loot.tsx         Instanced mesh mirroring ground drops
    DamageNumbers.tsx  Floating per-hit numbers, sized by damage
    Vision.tsx       The player's range-of-vision fog overlay
    Simulation.tsx   Headless per-frame sim driver
  App.tsx          Areas, mob spawning (point pools), HUD; wires scene + input
```

### Design notes

- **Renderer and simulation are kept separate** — sim state is `pos`/`vel`
  components on ECS entities; scene components copy positions into meshes
  each frame and never own game state.
- **The hot loop is imperative.** The sim tick, movement, and camera run in
  `useFrame`, mutating refs directly; React state is never touched per frame.
- **Composition is declarative.** Equipment is a component on an entity;
  swapping a weapon is a prop change, and the mesh mounts/disposes itself.
- **Determinism** — the sim is pure JS and all randomness is seeded rot.js
  RNG, so the same seed reproduces the same run.

## Next steps

See [`ROADMAP.md`](./ROADMAP.md) — inventory UI, a main menu with character
creation and a world seed, area difficulty budgets, footsteps-based hearing,
a minimap of observed enemies, then rarity and the fittings-and-cogs
upgrade system.
