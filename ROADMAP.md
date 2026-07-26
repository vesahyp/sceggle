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

- **Feel: Minecraft Dungeons / Diablo, not NetHack.** Real-time hack-slash on
  an open seeded overworld — scattered obstacle clusters to kite around, not
  rooms-and-corridors. Loot-driven itemization.
- **Weapons are 50/50 melee and ranged.** Every drop pool keeps that balance;
  ranged fires projectiles at the cursor.
- **Setting: steampunk — deferred.** Placeholder capsules/boxes and generic
  ids (`mob<level>`, `weapon-<type>-<level>`) until the loop proves out. No
  naming/theming work before then.
- **Itemization: Diablo/Borderlands hybrid.**
  - **Rarity ladder:** grey → green → blue → yellow → orange. Rarity drives
    the stat budget **and** the number of attachment points (0/1/2/3/4).
  - **Fittings & cogs** (steampunk for "sockets" and "gems/mods"): weapons
    roll colored **fittings**; **cogs** are dropped components with one
    color; a cog installs only into a fitting of the same color — *yellow
    goes to yellow*. Cog effects are stat/behaviour modifiers (±damage,
    +knockback, +projectile speed, on-hit stagger, …); higher colors gate
    stronger effect pools.
  - Naming: *fitting* is a real machinist's term (brass fittings) and reads
    steampunk without being cute; *cog* is the iconic steampunk unit.
    "Gadget" stays reserved for a possible active-use item class.

## Now / next

### 1. Inventory & equip UI
- Inventory as React DOM beside the canvas (the R3F DOM-alongside-canvas
  payoff). Pickups go into the inventory; equip/compare/drop from the panel.
  Walk-over-to-equip and the dev weapon-reroll key retire.
- **Done when:** you can hold more than one weapon and choose what's in hand.

### 2. Main menu, character creation & world seed
- A main menu before the game: new run rolls (or lets you enter) a **world
  seed**, shown in the HUD — the one number every generation derives from.
  Today's fixed `SEED = 1337` retires.
- **Character creation:** the player is generated like everything else — a
  point pool distributed across stats (max HP, move speed, …) by the player
  instead of the RNG. Same seed + same build → same run.
- **Done when:** two runs with different seeds differ everywhere; re-entering
  a seed reproduces the run.

### 3. Area difficulty budget
- Mob *rosters* stop being formula-coded: each area gets a difficulty point
  pool (from its area number) that buys the roster — how many mobs, their
  level mix, their placement — with each mob then rolling its own stat pool
  as today.
- Sweep the remaining hardcoded per-mob values (sight, hearing, attack
  standoff) into the spawn roll.
- **Done when:** no spawn-count/level constants remain in `App.spawnMobs`.

### 4. Footsteps & noise
- **Footstep weight** becomes a property of every moving thing (player and
  mobs): moving emits noise whose radius scales with weight and speed.
- Mob *hearing* reacts to that noise instead of raw proximity — standing
  still is quiet; sprinting past a wall isn't.
- Visualize it: expanding ripple rings from movers when they step, and
  hearing ranges shown like the sight rings are today.
- Actual footstep audio (first sound in the game).
- **Done when:** you can sneak past a mob by moving carefully, and see
  exactly why it did or didn't hear you.

### 5. Minimap of observed enemies
- Corner minimap: terrain you've seen (discovery memory) plus the last
  observed position of each enemy — observed meaning inside your vision,
  not omniscient.
- **Done when:** you can navigate an explored area and track known enemies
  from the map alone.

### 6. Rarity on drops
- Weapons and mobs are already point-budget generated (`generateWeapon`,
  `App.spawnMobs`); rarity layers on top: a drop rolls a rarity tier from
  the ladder via seeded RNG, granting bonus budget and driving the
  ground-marker color (and fitting count, later).
- **Done when:** two drops from the same mob level can differ in rarity,
  visibly.

### 7. Fittings & cogs v0
- Weapons roll colored fittings by rarity; cogs drop as items; an install UI
  enforces color-match. Ship two cog effects end-to-end (e.g. +knockback,
  +projectile speed) so the choice is real.
- **Done when:** slotting a cog visibly changes how a weapon plays.

## Later

### 8. Armor & damage model
- Activate the scaffolded `armor` component: `damage = max(1, raw - armor.value)`.
- Knockback stays weapon-driven; armor only mitigates HP loss.
- Revisit soft death (currently: respawn at the area entry with full HP) —
  add a real run-over state or a death cost.

### 9. Content & feel
- Enemy variety beyond level scaling (component-composed): rusher, sniper,
  heavy — distinct AI, not just stat spreads.
- More hit feedback: screen shake, mob death effect.
- A lighting/readability pass — the field is murky and rarity colors will
  need to read at a glance.

### 10. World variety
- Biome variation of the scatter generator (density, cluster size, palette),
  bought from the same area budget as the roster.

## Someday / ideas

- Steampunk theming pass: real meshes, names, palette (see Design direction).
- Save/resume via seed + action log (determinism makes this cheap).
- Fuller audio beyond footsteps: combat sounds, ambience.
- WebGPU renderer path once `@react-three/fiber` support is comfortable.
