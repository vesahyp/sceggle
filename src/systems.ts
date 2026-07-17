import { players, mobs } from './ecs';

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
    hits++;
  }
  return hits;
}
