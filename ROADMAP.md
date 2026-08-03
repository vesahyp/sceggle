# Roadmap

Forward-looking plan for sceggle — a top-down hack-slash-loot. Items are
roughly ordered; each is scoped to be shippable on its own. Delete items as
they land (git history is the changelog).

## Guiding principles

- **Composable over clever.** New behaviour is a new component/system, not a
  new class hierarchy. Extend the `Entity` type in `src/ecs.ts`.
- **Renderer and simulation stay separate.** Game state lives in the ECS;
  React/three.js only reflect it.
- **Generated, not authored.** Nothing is hand-placed or hardcoded: content
  rolls from point budgets (weapons, mobs, and eventually rosters, areas,
  and the character itself). Every play is different. Constants that remain
  in code are placeholders waiting to be swept into generation.
- **Determinism is a feature.** Everything random goes through a seeded
  source (rot.js RNG) derived from one world seed. Same seed → same run.
- **One combat system.** Player and mobs use identical attack mechanics
  (shared swing/projectile code paths); only stats and targets differ.
- **Keep the hot loop imperative.** Per-frame work mutates refs in `useFrame`;
  React state is for structure and UI, not simulation.
- **No physics engine.** Movement/collision is the tiny kinematic sim in
  `src/systems.ts` + `src/worldmap.ts`. Don't reintroduce one — it got in
  the way.

## Design direction (decided)

- **Feel: horde hack-slash — kill lots of enemies in various ways with
  weapons you construct.** Real-time on an open seeded overworld — scattered
  obstacle clusters to kite around. Pack-based spawning (swarms, rushers,
  snipers, exploders, spawners, elites), loot-driven itemization.
- **The player is ranged-only.** Guns fire at the cursor / aim stick; melee
  exists solely on the mob side, and only gun-carriers drop weapons.
- **Weapons are constructed, not just rolled:** guns roll fitting slots;
  **cogs** (mechanism parts) drop and install to change what an attack DOES
  — chain, scald, pull, corpse-burst, ricochet, split. Behaviors are shared
  player/mob (one combat system).
- **Stealth reads on the ground:** every mob rolls a directional vision cone
  and a hearing radius, both drawn truthfully; idle mobs wander. Player
  footsteps ripple as the noise-to-be.
- **Setting: steampunk — deferred.** Placeholder capsules/boxes and generic
  ids (`mob<level>`, `weapon-<type>-<level>`, `cog-<type>-<power>`) until
  the loop proves out. No naming/theming work before then.
- **Itemization: Diablo/Borderlands hybrid.**
  - **Rarity ladder:** grey → green → blue → yellow → orange. Rarity drives
    the stat budget **and** the fitting count (today fittings come flat from
    level; rarity should take that over).
  - **Color-matched fittings** (cog installs only into a same-color fitting)
    remain an open idea to deepen construction once rarity ships.

## Now / next

### 1. Main menu, character creation & world seed
- A main menu before the game: new run rolls (or lets you enter) a **world
  seed**, shown in the HUD — the one number every generation derives from.
  Today's fixed `SEED = 1337` retires.
- **Character creation:** the player is generated like everything else — a
  point pool distributed across stats (max HP, move speed, …) by the player
  instead of the RNG. Same seed + same build → same run.
- **Done when:** two runs with different seeds differ everywhere; re-entering
  a seed reproduces the run.

### 2. Area difficulty budget
- Mob *rosters* stop being formula-coded: each area gets a difficulty point
  pool (from its area number) that buys the roster — how many mobs, their
  level mix, their placement — with each mob then rolling its own stat pool
  as today.
- Sweep the remaining hardcoded per-mob values (sight, hearing, attack
  standoff) into the spawn roll.
- **Done when:** no spawn-count/level constants remain in `App.spawnMobs`.

### 3. Footsteps & noise (the mechanic)
- The visualization shipped (player footstep ripples, mob hearing rings);
  now make it true: **footstep weight** on every mover, noise radius scaling
  with weight and speed, and mob *hearing* reacting to emitted noise instead
  of raw proximity — standing still is quiet; sprinting past a wall isn't.
- Actual footstep audio (first sound in the game).
- **Done when:** the ripple you see IS the noise mobs hear — walking slowly
  past a hearing ring that sprinting would have tripped.

### 4. Minimap of observed enemies
- Corner minimap: terrain you've seen (discovery memory) plus the last
  observed position of each enemy — observed meaning inside your vision,
  not omniscient.
- **Done when:** you can navigate an explored area and track known enemies
  from the map alone.

### 5. Rarity on drops
- Weapons and mobs are already point-budget generated (`generateWeapon`,
  `App.spawnMobs`); rarity layers on top: a drop rolls a rarity tier from
  the ladder via seeded RNG, granting bonus budget, driving the
  ground-marker color, and taking over the fitting count (today it comes
  flat from level).
- **Done when:** two drops from the same mob level can differ in rarity,
  visibly.

## Later

### 6. Armor & damage model
- Activate the scaffolded `armor` component: `damage = max(1, raw - armor.value)`.
- Knockback stays weapon-driven; armor only mitigates HP loss.
- Revisit soft death (currently: respawn at the area entry with full HP) —
  add a real run-over state or a death cost.

### 7. Lighting & readability pass
- The field is murky; rarity colors and the sense-visualization layers
  (cones, rings, ripples) need to read at a glance without adding clutter.

### 8. World variety
- Biome palette/flavor on top of the structured generator (rock masses,
  arenas, roads, ruins already vary per seed) — tint sets and obstacle
  shapes bought from the same area budget as the roster.

## Someday / ideas

- Steampunk theming pass: real meshes, names, palette (see Design direction).
- Save/resume via seed + action log (determinism makes this cheap).
- Fuller audio beyond footsteps: combat sounds, ambience.
- WebGPU renderer path once `@react-three/fiber` support is comfortable.
