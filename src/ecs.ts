import { World } from 'miniplex';
import type { MechanismDef, WeaponDef } from './weapons';

/**
 * The Entity is the whole game-object vocabulary in one place. Every field is
 * optional: an entity "is" whatever components it currently has. That is the
 * composability you get from an ECS — giving a mob armor or a weapon is adding
 * a field, not subclassing a MobWithSwordAndArmor.
 *
 * Simulation state lives in plain `pos`/`vel` components — there is no physics
 * engine. Entities must be constructed *complete* before `world.add()` (or
 * gain components via `world.addComponent`): late-attaching a component with
 * plain assignment won't reindex the archetypes. Mutating the *fields* of
 * `pos`/`vel` every frame is fine — that is the intended hot path.
 */
export interface Entity {
  /** Tag components — presence marks a role. */
  player?: true;
  mob?: true;

  /** Stable identity for React keys (spawn order within an area). */
  id?: number;

  /** World-plane position; Y is a render-only constant. */
  pos?: { x: number; z: number };
  /** Current velocity (world units/s). Steering overwrites it each frame;
   *  knockback writes it and damping decays it during stagger. */
  vel?: { x: number; z: number };
  /** Collision circle radius (obstacle sliding + projectile hits). */
  radius?: number;

  /** Grid spawn cell (for reference / respawn). */
  spawn?: { x: number; z: number };

  /** Currently equipped weapon (swap = reassign this field). */
  weapon?: WeaponDef;

  /** Unit vector (x,z) the entity is aiming/facing. Drives swing direction. */
  aim?: { x: number; z: number };
  /** World distance to the aim TARGET (cursor / hunted player) — lob shots
   *  land there instead of flying to max range. Views/AI keep it fresh. */
  aimDist?: number;

  /** Example stat component — extend with armor, statuses, etc. */
  health?: { current: number; max: number };
  armor?: { value: number };

  /** Seconds left of the "just got hit" white flash (view feedback).
   *  Initialize at spawn — not queried, but keep entities born complete. */
  hitFlash?: number;

  /** Player-only: seconds of hit-stun left. While stunned, input doesn't
   *  steer — the incoming knockback plays out and decays instead. */
  stun?: number;

  /** Seconds grass concealment stays broken after attacking — firing gives
   *  you away (Brawl rule). Set by startAttack for BOTH sides (one combat
   *  path); only the player's is read by perception today. */
  reveal?: number;

  /** An in-flight attack, either kind: `t` runs over windup + duration.
   *  During `windup` nothing can connect — the blade winds back, the shot is
   *  drawn — that's the telegraph, and a staggering hit cancels it. Then
   *  melee sweeps the strike point over `duration` (hitting each target at
   *  most once, only where the blade actually is), while ranged releases its
   *  projectiles the moment windup ends and rides out `duration` as
   *  recovery (see systems.stepAttacks). Cleared when done. */
  attack?: {
    t: number;
    windup: number;
    duration: number;
    /** Ranged: latches once the projectiles have left. */
    fired?: boolean;
    struck: Entity[];
  };

  /** Power tier of a mob — scales stats and the loot it drops. */
  level?: number;

  /** Body tint, rolled at spawn (also colors the corpse it leaves). */
  tint?: string;

  /** What this mob leaves behind, pre-rolled at spawn (deterministic; the
   *  kill itself draws no RNG). Absent = drops nothing. */
  drops?: { weapon?: WeaponDef; part?: MechanismDef };

  /** Walking bomb: once alerted and close, it lights its fuse, halts, and
   *  detonates — damaging BOTH sides, so packs of these chain off each
   *  other. Dying to damage also sets it off. */
  volatile?: { radius: number; damage: number; fuse: number; lit: boolean };

  /** Stationary mob that releases pre-rolled chaff while alerted. The
   *  spawnees were generated with the area (determinism); the sim only picks
   *  when and where they step out. */
  spawner?: { interval: number; next: number; pending: Entity[] };

  /** Damage-over-time burn (the `scald` mechanism). Ticks every `interval`
   *  seconds until `until` (a countdown). Queried — attach via
   *  world.addComponent, never plain assignment. */
  burning?: { damage: number; interval: number; next: number; until: number };

  /** A body in flight: launched by the killing blow, tumbles, fades, gone.
   *  Pure spectacle — corpses collide with nothing. */
  corpse?: { t: number; life: number; tint: string; size: number; spin: number };

  /** Fractional resistances, 0 (none) → 1 (immune). Bought from the mob's
   *  spawn point pool, so same-level mobs still differ. Incoming knockback
   *  velocity and stagger duration are scaled by (1 - resist). */
  resist?: { knockback: number; stagger: number };

  /** Steering speed (world units/s) — bought from the mob's spawn pool. */
  moveSpeed?: number;

  /** Breakable blocker occupying one grid cell that was stamped solid at
   *  spawn. Shots and explosions damage it; at 0 HP the cell carves back to
   *  floor (collision/LOS/A* honor it immediately) and the view unmounts.
   *  Barrels carry `explosive` and detonate on death — hurting BOTH sides
   *  and chaining through the explosion queue. Not a mob: no `vel`, no
   *  `mob` tag, so crowd/AI/melee systems ignore it by construction. */
  destructible?: {
    cell: { x: number; z: number };
    explosive?: { radius: number; damage: number };
  };

  /** A patch of burning ground left by a lob shell: ticks damage on the
   *  opposing side while `life` runs down. A state, not an impact — ticks
   *  carry no knockback or hit-stop (like `burning`). */
  zone?: {
    faction: 'player' | 'mob';
    radius: number;
    /** Damage per tick. */
    damage: number;
    interval: number;
    next: number;
    life: number;
  };

  /** Presence makes the entity a ground pickup. Exactly one of the two:
   *  a weapon (walk over to equip) or a mechanism part (walk over to install
   *  into the equipped weapon — skipped, left lying, if incompatible). */
  loot?: { weapon?: WeaponDef; part?: MechanismDef };

  /** Presence makes the entity a projectile: it flies along `vel` until it
   *  hits an obstacle or runs out of range. A mob hit stops it too, unless
   *  it pierces — then it keeps flying through. */
  projectile?: {
    /** Who fired it — player shots hit mobs, mob shots hit the player. */
    faction: 'player' | 'mob';
    damage: number;
    /** Velocity magnitude imparted to whatever it hits. */
    knockback: number;
    /** Seconds of stagger inflicted on hit (before target resistance). */
    stagger: number;
    speed: number;
    maxRange: number;
    traveled: number;
    pierce: boolean;
    /** Wall bounces left (the `ricochet` mechanism). */
    bounces: number;
    /** Fragments to shatter into on impact (the `split` mechanism); 0 = none. */
    splits: number;
    /** Detonation radius where the shot ends its flight; 0 = plain shot. */
    blast: number;
    /** Lobbed: arcs over walls AND bodies, resolves only at end of flight. */
    lob: boolean;
    /** Seconds of ground fire left behind where a lob lands; 0 = none. */
    linger: number;
    /** On-hit mechanisms carried from the firing weapon (chain, scald, …). */
    mechanisms: MechanismDef[];
    /** Mobs already hit — a piercing projectile hurts each mob only once. */
    struck: Entity[];
  };

  /**
   * Enemy AI state. Presence makes a mob perceive and hunt the player: a mob
   * notices the player by *sight* (within `sight` distance, inside the `fov`
   * cone around where it's facing, AND unobstructed line of sight) or by
   * *hearing* (within `hearing` distance, obstacles or not). Vision is
   * directional and rolled per mob — that's what makes sneaking a mechanic:
   * the view draws each mob's cone, and you slip past behind it. Until
   * alerted the mob wanders between nearby points, facing where it walks.
   * Once `alerted` it chases for good: it follows the shared flow field
   * toward the player and resolves its actual heading with context steering
   * (see systems.updateEnemyAI).
   */
  brain?: {
    /** Which way this mob circles its target: +1 or -1, rolled at spawn so a
     *  pack splits both ways around you instead of orbiting in lockstep. */
    strafe: number;
    /** See distance (needs facing + clear line of sight). */
    sight: number;
    /** Half-angle (radians) of the vision cone around `aim`. */
    fov: number;
    /** Hear distance (works through obstacles). */
    hearing: number;
    /** Latched once the player is noticed (or the mob is hit). */
    alerted: boolean;
    /** Preferred fighting distance (melee reach / ranged stand-off). The mob
     *  closes when further out, gives ground when well inside it, and orbits
     *  once it's there. */
    attackRange: number;
    /** Seconds until this mob may attack again (1/weapon.rate cadence). */
    attackIn: number;
    /** Seconds of "don't steer" after a hit, so knockback plays out. */
    stagger: number;
    /** Idle roaming: current destination (none = resting) and the seconds
     *  until the next decision roll. */
    wanderTarget?: { x: number; z: number };
    wanderIn: number;
    /** Guard post: when set, wander targets are picked around this anchor
     *  instead of the mob's own position — the mob holds its station until
     *  alerted. Radius is the leash: small = sentry, large = patroller. */
    post?: { x: number; z: number; radius: number };
  };
}

/** Single source of truth for simulation entities. */
export const world = new World<Entity>();

/** Archetype queries used by systems. */
export const players = world.with('player', 'pos', 'vel');
export const mobs = world.with('mob', 'pos', 'vel');
export const projectiles = world.with('projectile', 'pos', 'vel');
export const loots = world.with('loot', 'pos');
export const corpses = world.with('corpse', 'pos', 'vel');
export const burners = world.with('burning', 'health', 'pos');
export const destructibles = world.with('destructible', 'pos', 'health');
export const zones = world.with('zone', 'pos');

// Dev-only: expose the world for debugging in the browser console.
if (import.meta.env.DEV) {
  (globalThis as unknown as { world: World<Entity> }).world = world;
}
