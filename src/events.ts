import type { Entity } from './ecs';
import type { WeaponDef } from './weapons';

/**
 * One-way bridge from the simulation to React. The sim runs imperatively in
 * useFrame and can't touch React state; React owns structure (which mobs are
 * mounted, which weapon is equipped, which area we're in). When the sim
 * decides something structural — a mob died, loot was picked up, the player
 * reached the exit — it emits here and App updates its state declaratively.
 */
export type GameEvent =
  | { type: 'mobDied'; mob: Entity }
  | { type: 'pickup'; weapon: WeaponDef }
  | { type: 'exitReached' }
  /** A hit landed — drives floating damage numbers and the HP readout. */
  | { type: 'damage'; x: number; z: number; amount: number; target: 'mob' | 'player' }
  | { type: 'playerDied' };

type Listener = (e: GameEvent) => void;

const listeners = new Set<Listener>();

export function onGameEvent(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emitGameEvent(e: GameEvent): void {
  for (const fn of listeners) fn(e);
}
