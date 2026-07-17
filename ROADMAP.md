# Roadmap

Forward-looking plan for sceggle — a top-down 3D roguelike. Items are roughly
ordered; each is scoped to be shippable on its own. Check things off as they
land, and keep the "Done" section as a short changelog.

## Guiding principles

- **Composable over clever.** New behaviour is a new component/system, not a
  new class hierarchy. Extend the `Entity` type in `src/ecs.ts`.
- **Renderer and simulation stay separate.** Game state lives in the ECS;
  React/three.js only reflect it.
- **Determinism is a feature.** Everything random goes through a seeded source
  (rot.js RNG). Same seed → same run.
- **Keep the hot loop imperative.** Per-frame work mutates refs in `useFrame`;
  React state is for structure and UI, not simulation.

## Now / next

### 1. Enemy AI — pathfinding & chase
- Give mobs a `brain` component and a system that runs rot.js Dijkstra/A*
  (`ROT.Path.AStar`) over the dungeon grid toward the player.
- Move mobs along the path via Rapier velocity (reuse the player's movement
  approach). Stop at attack range.
- **Done when:** the goblin navigates walls to chase the player.

### 2. Combat loop — enemies fight back & can die
- Mobs attack when in range (mirror of `performAttack`, weapon-driven).
- Wire up the existing `health` component: apply damage, despawn at ≤0
  (remove from the ECS world → R3F unmounts the entity).
- Player death → run-over state.
- **Done when:** you can kill the goblin and it can kill you.

### 3. Armor & damage model
- Activate the scaffolded `armor` component: `damage = max(1, raw - armor.value)`.
- Knockback stays weight-driven; armor only mitigates HP loss.
- **Done when:** equipping armor visibly reduces damage taken.

### 4. Field of view / fog of war
- Use `ROT.FOV.PreciseShadowcasting` from the player's cell each move.
- Dim/hide unseen tiles (per-instance color or visibility) with a "seen but not
  visible" memory tier.
- **Done when:** the dungeon reveals as you explore.

## Later

### 5. Turn / energy system (optional but roguelike-defining)
- Decide the core model: real-time-with-physics (current) vs. classic
  energy-based turns. A hybrid (physics for knockback, turns for actions) is
  viable — prototype before committing.

### 6. Level structure
- Stairs + multiple floors; regenerate on descend with an increasing seed.
- Simple depth-based difficulty scaling (mob count / stats).

### 7. Items & inventory
- Item entities on the floor; pickup on overlap.
- Inventory as React UI (this is where R3F's DOM-alongside-canvas pays off).
- Weapons/armor become pickups rather than hardcoded loadouts.

### 8. Content & feel
- Enemy variety (component-composed: fast/weak, slow/heavy-knockback, ranged).
- Hit feedback: flash, screen shake, damage numbers.
- Basic audio.
- Replace capsule/box placeholders with real (or stylized) meshes.

## Someday / ideas

- Procedural generation beyond Digger (cellular caves, prefab rooms).
- Save/resume via seed + action log (determinism makes this cheap).
- WebGPU renderer path once `@react-three/fiber` support is comfortable.
- Performance: `InstancedRigidBodies` if mob counts get large.

## Done

- **Starter scaffold** — Vite + TS + React, three.js/R3F rendering, Rapier
  physics (weight-scaled knockback), Miniplex ECS, rot.js seeded dungeon.
  Player movement, swappable weapons on player & mob, HUD. (PR #1)
