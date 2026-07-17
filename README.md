# sceggle

A top-down 3D roguelike starter — code-first, minimal, own-the-loop.

> Reboot of a 2016 WebGL scene-graph experiment. Rather than build a renderer
> from scratch on the (now-defunct) stack.gl toolchain, this version composes a
> game from modern, maintained libraries. The original code is preserved under
> [`legacy/`](./legacy).

## Stack

| Concern | Library |
|---|---|
| Rendering / scene graph | [three.js](https://threejs.org) via [@react-three/fiber](https://docs.pmnd.rs/react-three-fiber) |
| Physics (knockback, collisions) | [Rapier](https://rapier.rs) via [@react-three/rapier](https://github.com/pmndrs/react-three-rapier) — deterministic |
| Entities / composition | [Miniplex](https://github.com/hmans/miniplex) ECS |
| Dungeon gen, FOV, pathfinding, RNG | [rot.js](https://ondras.github.io/rot.js/hp/) |
| Build / dev server | [Vite](https://vitejs.dev) + TypeScript |

## Run

```bash
npm install
npm run dev      # http://localhost:5173
```

`npm run build` type-checks and produces a production bundle.

## Controls

- **W A S D** — move
- **Space** — attack; nearby enemies are knocked back with an impulse
  proportional to your weapon's `weight`
- **1** — cycle your weapon (dagger → longsword → warhammer)
- **2** — cycle the goblin's weapon (demonstrates entity composition)

## How it's organized

```
src/
  ecs.ts          Miniplex world + Entity component vocabulary
  weapons.ts      Weapon data (weight → knockback, plus held-mesh shape)
  dungeon.ts      rot.js map generation → grid + walkable cells
  systems.ts      Combat: swing → weight-scaled knockback impulse
  input.ts        Keyboard (held state + edge-triggered presses)
  scene/          React-three-fiber render components
    Dungeon.tsx   Instanced tiles/walls + Rapier colliders
    Player.tsx    Imperative movement, camera follow, held weapon
    Mob.tsx       Goblin body + swappable held weapon
    Weapon.tsx    Held-weapon mesh, driven purely by weapon data
  App.tsx         Wires the scene, HUD, and input together
```

### Design notes

- **Renderer and physics are kept separate** — the dungeon grid produces both
  instanced visuals and Rapier colliders independently.
- **The hot loop is imperative.** Movement and camera run in `useFrame`,
  mutating refs directly; React state is never touched per frame.
- **Composition is declarative.** Equipment is a component on an entity;
  swapping a weapon is a prop change, and the mesh mounts/disposes itself.
- **Determinism** comes from Rapier + seeded rot.js RNG — reproducible runs.

## Next steps

Enemy AI (rot.js pathfinding), turn/energy system, field-of-view fog,
armor mitigation (the `armor` component already exists), multiple floors,
and item pickups.
