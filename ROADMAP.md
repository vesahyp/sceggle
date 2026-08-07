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
- **The world is open ground with things placed on it**, never corridors
  carved out of rock: each area rolls a **layout archetype** (plains, ruins,
  canyon, colosseum, caverns) that dresses the same skeleton — an arena
  spine of open fight pockets running west → east, roads between them, cover
  in the gaps. Variety is the archetype roll; open space is the default.
- **Move-and-shoot at full speed** (Brawl Stars feel): attacking is not a
  movement commitment for either side — kiting IS the combat.
- **The player is ranged-only.** Guns fire at the cursor / aim stick; melee
  exists solely on the mob side. Guns roll a delivery archetype: **bolts**
  fly straight and can buy blast/pierce; **lobs** arc over walls and bodies,
  land at the cursor, always detonate, and leave burning ground (area
  denial) — with rolled fan spread on multishot for shotgun-to-burst
  variance. Melee-carrying mobs scavenge: a fraction hold a looted gun and
  drop it, so the horde itself pays out weapons.
- **The map fights back:** grass conceals (eyes fail at any range, ears
  still work, firing reveals you), crates are cover until they're shot
  apart, and barrels detonate and chain, hurting both sides.
- **The exit is defended:** a share of each area's spawn pool stations
  guard packs around the exit pad on sentry/patrol leashes; the rest of the
  roster roams the field as before.
- **Runs start from a menu:** continue (backgrounding auto-pauses) / new
  game → pick a **character archetype** and a **world seed** (rolled or
  typed — re-entering one replays that run). Archetypes are Brawl-style
  genre stereotypes (bruiser, sharpshooter, artillerist, skirmisher)
  implemented as preset spends of one shared character point budget
  (`src/characters.ts`); each constrains the seeded starter-gun roll, so
  the pick decides HOW you fight and the seed decides the numbers.
- **In-run RPG progression:** kills pay XP (level², so elites matter); each
  character level pauses for ONE point the player spends on the same ramps
  the archetypes are built from — vigor, boots, plating, or hands (attack
  rate, via the shared `rateScale` component both cadence gates honor).
  Progression resets with the run; same seed + same picks → same run.
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

### 1. Area difficulty budget
- Mob *rosters* stop being formula-coded: each area gets a difficulty point
  pool (from its area number) that buys the roster — how many mobs, their
  level mix, their placement — with each mob then rolling its own stat pool
  as today.
- Sweep the remaining hardcoded per-mob values (sight, hearing, attack
  standoff) into the spawn roll. The guard-pool share and the destructible
  pool (`App.spawnDestructibles`) should fold into the same area budget.
- **Done when:** no spawn-count/level constants remain in `App.spawnMobs`.

### 2. Noise, the rest of it
- The mechanic landed for the player: shots and detonations raise
  disturbances mobs investigate (`emitNoise`), and how far the player is
  heard scales with how fast they're moving. What's missing is **footstep
  weight on every mover** — mobs make no noise at all today, so a pack can't
  be heard coming and a heavy elite sounds like nothing.
- Noise should carry differently through terrain: right now radius is radius,
  and a wall between you and the bang costs it nothing.
- Actual footstep audio (first sound in the game), and a bang the player can
  hear as well as see.
- **Done when:** you can hear a pack before you see it, and cover muffles.

### 3. Minimap of observed enemies
- Corner minimap: terrain you've seen (discovery memory) plus the last
  observed position of each enemy — observed meaning inside your vision,
  not omniscient.
- **Done when:** you can navigate an explored area and track known enemies
  from the map alone.

### 4. Rarity on drops
- Weapons and mobs are already point-budget generated (`generateWeapon`,
  `App.spawnMobs`); rarity layers on top: a drop rolls a rarity tier from
  the ladder via seeded RNG, granting bonus budget, driving the
  ground-marker color, and taking over the fitting count (today it comes
  flat from level).
- **Done when:** two drops from the same mob level can differ in rarity,
  visibly.

## Chores

### postcss ≥ 8.5.23 (GHSA-fxqj-rqcc-2cmp)
- Dependabot flags `postcss@8.5.20`, a dev-only transitive of vite: attacker
  CSS with a crafted `sourceMappingURL` can read arbitrary `.map` files when
  PostCSS runs without `from`. Not reachable here — vite compiles our own
  `src/styles.css` with `from` set — so this is alert hygiene, not urgency.
- Blocked until **2026-08-08** by `min-release-age=14` in `~/.npmrc`: the
  first patched version (8.5.23, published 2026-07-24) is younger than the
  gate, so `npm audit fix` silently caps at the still-vulnerable 8.5.22.
  Don't override the gate to grab a fresher release — the supply-chain guard
  is worth more than this advisory.
- **Done when:** `npm update postcss` (no flags) lands ≥ 8.5.23 inside
  vite's `^8.5.16` range and `npm audit` is clean, package.json untouched.

## Later

### 5. Armor & damage model
- Activate the scaffolded `armor` component: `damage = max(1, raw - armor.value)`.
- Knockback stays weapon-driven; armor only mitigates HP loss.
- Revisit soft death (currently: respawn at the area entry with full HP) —
  add a real run-over state or a death cost.

### 6. Lighting & readability pass
- The field is murky; rarity colors and the sense-visualization layers
  (cones, rings, ripples) need to read at a glance without adding clutter.

## Someday / ideas

- Freeform character creation: expose the archetypes' shared point budget
  (`src/characters.ts`) as a player-directed allocation — the archetype
  cards become saved builds over the same spend.
- Steampunk theming pass: real meshes, names, palette (see Design direction).
- Save/resume via seed + action log (determinism makes this cheap).
- Fuller audio beyond footsteps: combat sounds, ambience.
- WebGPU renderer path once `@react-three/fiber` support is comfortable.
