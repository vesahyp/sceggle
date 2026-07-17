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

  /** Example stat component — extend with armor, statuses, etc. */
  health?: { current: number; max: number };
  armor?: { value: number };

  /**
   * Handle to the Rapier body once the <RigidBody> mounts. Systems read/write
   * physics through this. Set by the render component, cleared on unmount.
   */
  rb?: RapierRigidBody | null;
}

/** Single source of truth for simulation entities. */
export const world = new World<Entity>();

/** Archetype queries used by systems. */
export const players = world.with('player', 'rb');
export const mobs = world.with('mob', 'rb');
