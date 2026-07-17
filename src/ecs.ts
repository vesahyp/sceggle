import { World } from 'miniplex';
import type { RapierRigidBody } from '@react-three/rapier';
import type { WeaponDef } from './weapons';

/**
 * The Entity is the whole game-object vocabulary in one place. Every field is
 * optional: an entity "is" whatever components it currently has. That is the
 * composability you get from an ECS — giving a mob armor or a weapon is adding
 * a field, not subclassing a MobWithSwordAndArmor.
 */
export interface Entity {
  /** Tag components — presence marks a role. */
  player?: true;
  mob?: true;

  /** Grid spawn cell (for reference / respawn). */
  spawn?: { x: number; z: number };

  /** Currently equipped weapon (swap = reassign this field). */
  weapon?: WeaponDef;

  /** Unit vector (x,z) the entity is aiming/facing. Drives swing direction. */
  aim?: { x: number; z: number };

  /** Example stat component — extend with armor, statuses, etc. */
  health?: { current: number; max: number };
  armor?: { value: number };

  /**
   * Enemy AI state. Presence makes a mob hunt the player: a system pathfinds
   * toward the player's cell and steers the body along the route.
   */
  brain?: {
    /** Remaining grid cells to walk, nearest first. */
    path: Array<{ x: number; z: number }>;
    /** Seconds until the next A* recompute. */
    repathIn: number;
    /** Start chasing once the player is within this world distance. */
    aggro: number;
    /** Stop short at this world distance (melee stand-off). */
    attackRange: number;
    /** Seconds of "don't steer" after a hit, so knockback plays out. */
    stagger: number;
  };

  /**
   * Handle to the Rapier body once the <RigidBody> mounts. Systems read/write
   * physics through this. Published via {@link publishBody} so Miniplex reindexes
   * the `rb` archetypes; cleared via {@link unpublishBody} on unmount.
   */
  rb?: RapierRigidBody;
}

/** Single source of truth for simulation entities. */
export const world = new World<Entity>();

/** Archetype queries used by systems. */
export const players = world.with('player', 'rb');
export const mobs = world.with('mob', 'rb');

/**
 * Attach a Rapier body to an entity. Must go through addComponent (not a plain
 * assignment) or Miniplex won't add the entity to the `rb` archetypes that the
 * systems iterate.
 */
export function publishBody(entity: Entity, rb: RapierRigidBody): void {
  if (entity.rb === rb) return;
  if (entity.rb) world.removeComponent(entity, 'rb');
  world.addComponent(entity, 'rb', rb);
}

/** Detach the Rapier body (on unmount). */
export function unpublishBody(entity: Entity): void {
  if (entity.rb) world.removeComponent(entity, 'rb');
}

// Dev-only: expose the world for debugging in the browser console.
if (import.meta.env.DEV) {
  (globalThis as unknown as { world: World<Entity> }).world = world;
}
