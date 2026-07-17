import * as ROT from 'rot-js';
import { players, mobs } from './ecs';
import { cellToWorld, worldToCell, type Dungeon } from './dungeon';

const MOB_SPEED = 3.2; // a touch slower than the player, so you can kite

/**
 * Combat system: the player swings. Every mob within the equipped weapon's
 * reach takes a knockback impulse pointing away from the player, scaled by the
 * weapon's `weight`. This is the whole "a heavy sword shoves enemies" idea —
 * one impulse, read straight off the weapon component, applied through Rapier.
 *
 * Returns the ids of mobs that were hit (handy for flash effects / logging).
 */
export function performAttack(): number {
  const player = players.first;
  if (!player?.rb || !player.weapon) return 0;

  const p = player.rb.translation();
  const reach = player.weapon.reach;
  const weight = player.weapon.weight;
  let hits = 0;

  for (const mob of mobs) {
    if (!mob.rb) continue;
    const m = mob.rb.translation();
    const dx = m.x - p.x;
    const dz = m.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist > reach + 0.6) continue; // +0.6 fudge for body radii

    // Normalized shove direction (default forward if exactly overlapping).
    const nx = dist > 1e-4 ? dx / dist : 0;
    const nz = dist > 1e-4 ? dz / dist : 1;

    mob.rb.applyImpulse({ x: nx * weight, y: weight * 0.15, z: nz * weight }, true);
    if (mob.health) mob.health.current -= 1;
    // Let the shove play out before the AI reasserts its velocity.
    if (mob.brain) mob.brain.stagger = 0.4;
    hits++;
  }
  return hits;
}

/**
 * Enemy AI system: every mob with a `brain` pathfinds toward the player using
 * rot.js A* over the dungeon's walkable cells and steers its Rapier body along
 * the route, halting just short for melee. Paths are recomputed a few times a
 * second (cheap for the mob counts here) and followed every frame in between.
 *
 * Call once per frame from a useFrame with the frame `delta`.
 */
export function updateEnemyAI(dungeon: Dungeon, delta: number): void {
  const player = players.first;
  if (!player?.rb) return;

  const pp = player.rb.translation();
  const pCellX = worldToCell(pp.x);
  const pCellZ = worldToCell(pp.z);

  for (const mob of mobs) {
    const brain = mob.brain;
    if (!brain || !mob.rb) continue;

    const mp = mob.rb.translation();
    const vel = mob.rb.linvel();

    // Just got hit — ride out the knockback, don't fight the impulse.
    if (brain.stagger > 0) {
      brain.stagger -= delta;
      continue;
    }

    const dist = Math.hypot(pp.x - mp.x, pp.z - mp.z);

    // Idle outside aggro range; hold position once in melee range.
    if (dist > brain.aggro || dist <= brain.attackRange) {
      mob.rb.setLinvel({ x: 0, y: vel.y, z: 0 }, true);
      brain.path = [];
      continue;
    }

    // Periodically recompute the route to the player's current cell.
    brain.repathIn -= delta;
    if (brain.repathIn <= 0 || brain.path.length === 0) {
      brain.repathIn = 0.25;
      brain.path = computePath(dungeon, worldToCell(mp.x), worldToCell(mp.z), pCellX, pCellZ);
    }

    // Steer toward the next waypoint (fall back to a straight line at the player).
    let tx = pp.x;
    let tz = pp.z;
    if (brain.path.length > 0) {
      const next = brain.path[0];
      tx = cellToWorld(next.x);
      tz = cellToWorld(next.z);
      if (Math.hypot(tx - mp.x, tz - mp.z) < 0.25) {
        brain.path.shift();
      }
    }

    const dx = tx - mp.x;
    const dz = tz - mp.z;
    const len = Math.hypot(dx, dz) || 1;
    mob.rb.setLinvel({ x: (dx / len) * MOB_SPEED, y: vel.y, z: (dz / len) * MOB_SPEED }, true);
  }
}

/** A* over walkable cells; returns the route from (fromX,fromZ) to the target,
 *  excluding the mob's own starting cell. */
function computePath(
  dungeon: Dungeon,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
): Array<{ x: number; z: number }> {
  const astar = new ROT.Path.AStar(toX, toZ, (x, z) => !dungeon.isWall(x, z), { topology: 4 });
  const path: Array<{ x: number; z: number }> = [];
  astar.compute(fromX, fromZ, (x, z) => path.push({ x, z }));
  path.shift(); // first cell is where the mob already stands
  return path;
}
