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

## Design direction (decided)

- **Feel: Diablo II, not NetHack.** Real-time physics combat, act/zone structure
  with a hub + waypoints (not one infinite shaft or discrete ASCII floors),
  loot-driven itemization (rarity + affixes; weapon `weight` is the first affix),
  and softer death (checkpoints/revive, not one-life permadeath). This retires
  the turn/energy option below in favour of real-time.
- **Setting: "The Long Dark."** A sunless world; the last villages huddle around
  bonfires while the Frostmother's court spreads. You are a nameless drifter
  pushing outward across frozen acts. Full setting bible: [`SETTING.md`](./SETTING.md).
- **Two loot pillars** (see `SETTING.md` §6–8), unified by a single **light**
  economy: **Emberwork** (Diablo-style sockets/gems) and **Forgework**
  (Borderlands-style weapon construction from parts + maker quirks).

## Now / next

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

*(Turn/energy system is retired — the design is real-time, see Design direction.)*

### 5. Emberwork v0 — the light economy begins *(Diablo gems)*
- Add `sockets` (on gear) and `embers` (collectible) components; a `light`
  resource on the player (the coal).
- Ship one ember effect end-to-end (e.g. Coalfire warmth or Witchfire slow) and
  the light-cutter fuse recipe (3 of a tier → next). See `SETTING.md` §6.
- **Done when:** you can socket an ember and feel its effect in combat.

### 6. Forgework v0 — weapons vary *(Borderlands parts)*
- Generate a weapon's **Head** part (damage type + knockback/arc profile) so
  drops differ; `WeaponDef` becomes assembled rather than hardcoded.
- Introduce one maker quirk (e.g. Marrowkith bonebreak shockwave). See §7.
- **Done when:** two dropped weapons play noticeably differently.

### 7. Wardlights — waypoints & soft death
- Rekindle-able beacons: fast-travel points + revive checkpoints (the coal).
- **Done when:** dying returns you to the last rekindled wardlight.

### 8. Act / region structure
- Themed regions (Drowned Marsh → Black Forest → Glass Reach → Stillheart) with
  a Court boss per act; regenerate per region with a seed.
- Emberwatch as a safe hub.

### 9. Items & inventory
- Item entities on the floor; pickup on overlap.
- Inventory as React UI (this is where R3F's DOM-alongside-canvas pays off).
- Weapons/embers/garb become pickups rather than hardcoded loadouts.

### 10. Content & feel
- Enemy variety (component-composed): the Hushed, Rimewights, Lanternless.
- Hit feedback: flash, screen shake, damage numbers.
- Basic audio; replace capsule/box placeholders with stylized meshes.

## Someday / ideas

- Procedural generation beyond Digger (cellular caves, prefab rooms).
- Save/resume via seed + action log (determinism makes this cheap).
- WebGPU renderer path once `@react-three/fiber` support is comfortable.
- Performance: `InstancedRigidBodies` if mob counts get large.

## Done

- **Directional swings.** Aim comes from the mouse; a swing only hits mobs in a
  cone in front of you and launches them *along the swing direction* (blended
  with a little radial), not merely away — so facing and swing direction matter.
  The held weapon sweeps through an arc to sell the hit.
- **Enemy AI — pathfinding & chase.** Mobs carry a `brain` component; a system
  runs rot.js A* over the dungeon grid and steers the body toward the player,
  halting at melee range. Hits trigger a short "stagger" so knockback plays out
  before the AI reasserts control. Also fixed a latent bug: physics handles were
  never reaching the ECS (direct assignment instead of Miniplex `addComponent`,
  plus StrictMode-unsafe entity creation), so combat had silently done nothing.
- **Starter scaffold** — Vite + TS + React, three.js/R3F rendering, Rapier
  physics (weight-scaled knockback), Miniplex ECS, rot.js seeded dungeon.
  Player movement, swappable weapons on player & mob, HUD. (PR #1)
