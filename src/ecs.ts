import { World } from 'miniplex';
import type { WeaponDef } from './weapons';

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

  /** Example stat component — extend with armor, statuses, etc. */
  health?: { current: number; max: number };
  armor?: { value: number };

  /** Seconds left of the "just got hit" white flash (view feedback).
   *  Initialize at spawn — not queried, but keep entities born complete. */
  hitFlash?: number;

  /** Player-only: seconds of hit-stun left. While stunned, input doesn't
   *  steer — the incoming knockback plays out and decays instead. */
  stun?: number;

  /** An in-flight melee swing: the strike point sweeps the arc over
   *  `duration`, hitting each mob at most once, only where the blade
   *  actually is (see systems.stepMeleeSwings). Cleared when done. */
  melee?: {
    t: number;
    duration: number;
    struck: Entity[];
  };

  /** Power tier of a mob — scales stats and the loot it drops. */
  level?: number;

  /** Fractional resistances, 0 (none) → 1 (immune). Bought from the mob's
   *  spawn point pool, so same-level mobs still differ. Incoming knockback
   *  velocity and stagger duration are scaled by (1 - resist). */
  resist?: { knockback: number; stagger: number };

  /** Steering speed (world units/s) — bought from the mob's spawn pool. */
  moveSpeed?: number;

  /** Presence makes the entity a ground pickup: the player equips `weapon`
   *  by walking over it. */
  loot?: { weapon: WeaponDef };

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
    /** Mobs already hit — a piercing projectile hurts each mob only once. */
    struck: Entity[];
  };

  /**
   * Enemy AI state. Presence makes a mob perceive and hunt the player: a mob
   * notices the player by *sight* (within `sight` distance AND unobstructed
   * line of sight) or by *hearing* (within `hearing` distance, obstacles or
   * not). Once `alerted` it chases for good: a system pathfinds toward the
   * player's cell and steers the entity along the route.
   */
  brain?: {
    /** Remaining grid cells to walk, nearest first. */
    path: Array<{ x: number; z: number }>;
    /** Seconds until the next A* recompute. */
    repathIn: number;
    /** See distance (needs clear line of sight). */
    sight: number;
    /** Hear distance (works through obstacles). */
    hearing: number;
    /** Latched once the player is noticed (or the mob is hit). */
    alerted: boolean;
    /** Stop short at this world distance (melee reach / ranged stand-off). */
    attackRange: number;
    /** Seconds until this mob may attack again (1/weapon.rate cadence). */
    attackIn: number;
    /** Seconds of "don't steer" after a hit, so knockback plays out. */
    stagger: number;
  };
}

/** Single source of truth for simulation entities. */
export const world = new World<Entity>();

/** Archetype queries used by systems. */
export const players = world.with('player', 'pos', 'vel');
export const mobs = world.with('mob', 'pos', 'vel');
export const projectiles = world.with('projectile', 'pos', 'vel');
export const loots = world.with('loot', 'pos');

// Dev-only: expose the world for debugging in the browser console.
if (import.meta.env.DEV) {
  (globalThis as unknown as { world: World<Entity> }).world = world;
}
