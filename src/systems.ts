import * as ROT from 'rot-js';
import { world, players, mobs, projectiles, loots, type Entity } from './ecs';
import { cellToWorld, worldToCell, moveCircle, circleOverlapsWall, hasLineOfSight, type GameMap } from './worldmap';
import { generateWeapon } from './weapons';
import { emitGameEvent } from './events';

const MOB_SPEED = 3.2; // a touch slower than the player, so you can kite
/** Exponential decay of a shove during stagger/stun — high, so knockback
 *  reads as a sharp punch that eases out, not a long slide. */
const KB_DAMPING = 7;
/** knockback stat → shove velocity, on a square root: doubling the stat
 *  gives ~1.4× the shove. Diminishing returns keep heavy weapons from
 *  launching things across the map, and the resulting distances are short
 *  (roughly 0.8–1.8 units across the stat range). */
const KB_VEL = 4;
const shoveVelocity = (knockback: number) => KB_VEL * Math.sqrt(Math.max(knockback, 0));
/** The player shrugs off some knockback and can't be stun-locked. */
const PLAYER_KB_FACTOR = 0.6;
const PLAYER_STUN_CAP = 0.45;
const DEFAULT_RADIUS = 0.3;

/** Half-angle of the swing arc (70° to each side of the aim) — exported so
 *  the range indicator can show the true hit cone. */
export const SWING_HALF_ARC_RAD = (70 * Math.PI) / 180;
/** Half-thickness of the melee strike band: the blade connects only within
 *  this distance of its sweep radius. Long weapons therefore have a dead
 *  zone up close — a pole can't hit someone hugging you. */
export const MELEE_BAND = 0.55;

/** The hit band a melee weapon's strikes land in, as shown to the player
 *  (widened by a nominal mob body radius). */
export function meleeHitBand(reach: number): { inner: number; outer: number } {
  return {
    inner: Math.max(0.1, reach - MELEE_BAND - DEFAULT_RADIUS),
    outer: reach + MELEE_BAND + DEFAULT_RADIUS,
  };
}

/**
 * One simulation tick: AI steers, movers integrate against the grid,
 * projectiles fly. Called once per frame (before the view components copy
 * positions) with the frame delta.
 */
export function stepSimulation(map: GameMap, delta: number): void {
  updateEnemyAI(map, delta);
  stepMobAttacks(map, delta);
  stepMeleeSwings(delta);
  for (const e of players) {
    if (e.hitFlash) e.hitFlash = Math.max(0, e.hitFlash - delta);
    // Hit-stun: input is ignored (Player view checks `stun`), the shove decays.
    if (e.stun && e.stun > 0) {
      e.stun -= delta;
      const k = Math.exp(-KB_DAMPING * delta);
      e.vel.x *= k;
      e.vel.z *= k;
    }
    moveCircle(map, e.pos, e.vel, e.radius ?? DEFAULT_RADIUS, delta);
  }
  for (const e of mobs) moveCircle(map, e.pos, e.vel, e.radius ?? DEFAULT_RADIUS, delta);
  stepProjectiles(map, delta);
  checkPickups();
  checkExit(map);
}

/**
 * Mob offense: an alerted, un-staggered mob attacks the player on its
 * weapon's rate — with EXACTLY the player's mechanics. Melee starts the
 * same swept swing (strike band, dead zone, sub-stepped arc); ranged fires
 * the same projectile pipeline. The only mob-specific part is the decision
 * of *when*: melee waits until the target is inside the strike band, so a
 * pole mob won't whiff at someone hugging it.
 */
function stepMobAttacks(map: GameMap, delta: number): void {
  const player = players.first;
  if (!player) return;

  for (const mob of mobs) {
    const brain = mob.brain;
    const weapon = mob.weapon;
    if (!brain || !weapon) continue;
    brain.attackIn -= delta;
    if (!brain.alerted || brain.stagger > 0 || brain.attackIn > 0) continue;

    const dx = player.pos.x - mob.pos.x;
    const dz = player.pos.z - mob.pos.z;
    const dist = Math.hypot(dx, dz) || 1;
    const nx = dx / dist;
    const nz = dz / dist;

    if (weapon.kind === 'melee') {
      if (Math.abs(dist - weapon.reach) > MELEE_BAND + (player.radius ?? DEFAULT_RADIUS)) continue;
      brain.attackIn = 1 / weapon.rate;
      startSwing(mob, weapon);
    } else {
      if (dist > weapon.reach || !hasLineOfSight(map, mob.pos, player.pos)) continue;
      brain.attackIn = 1 / weapon.rate;
      world.add({
        projectile: {
          faction: 'mob',
          damage: weapon.damage,
          knockback: weapon.knockback,
          stagger: weapon.stagger,
          speed: weapon.speed,
          maxRange: weapon.reach,
          traveled: 0,
          pierce: false, // vs a single player, pierce is meaningless
          struck: [],
        },
        pos: { x: mob.pos.x + nx * 0.6, z: mob.pos.z + nz * 0.6 },
        vel: { x: nx * weapon.speed, z: nz * weapon.speed },
        radius: weapon.hitRadius,
      });
    }
  }
}

/**
 * Land a hit on the player: damage, knockback + hit-stun (input is dead
 * while it plays out), the white flash, and a damage number. At 0 HP a
 * single playerDied event fires — App handles the respawn.
 */
function damagePlayer(
  player: Entity,
  amount: number,
  dirX: number,
  dirZ: number,
  knockback: number,
  stagger: number,
): void {
  player.hitFlash = 0.2;
  const kb = shoveVelocity(knockback) * PLAYER_KB_FACTOR;
  player.vel!.x = dirX * kb;
  player.vel!.z = dirZ * kb;
  player.stun = Math.min(PLAYER_STUN_CAP, Math.max(player.stun ?? 0, stagger));
  emitGameEvent({ type: 'damage', x: player.pos!.x, z: player.pos!.z, amount, target: 'player' });

  const h = player.health;
  if (!h || h.current <= 0) return;
  h.current -= amount;
  if (h.current <= 0) emitGameEvent({ type: 'playerDied' });
}

/** Walking over a loot drop equips it (inventory is a roadmap item). */
function checkPickups(): void {
  const player = players.first;
  if (!player) return;
  const grabbed: Entity[] = [];
  for (const item of loots) {
    const d = Math.hypot(item.pos.x - player.pos.x, item.pos.z - player.pos.z);
    if (d < (player.radius ?? DEFAULT_RADIUS) + 0.35) grabbed.push(item);
  }
  for (const item of grabbed) {
    world.remove(item);
    emitGameEvent({ type: 'pickup', weapon: item.loot!.weapon });
  }
}

// Latch so standing on the exit emits once, not every frame until React
// swaps the area out.
let exitEmitted = false;

/** Reaching the exit cell hands control to React to advance the area. */
function checkExit(map: GameMap): void {
  const player = players.first;
  if (!player) return;
  const d = Math.hypot(player.pos.x - cellToWorld(map.exit.x), player.pos.z - cellToWorld(map.exit.z));
  if (d < 0.7) {
    if (!exitEmitted) {
      exitEmitted = true;
      emitGameEvent({ type: 'exitReached' });
    }
  } else if (d > 2) {
    exitEmitted = false;
  }
}

/**
 * Land a hit's push on a mob: shove along (dirX, dirZ) and stagger it, both
 * scaled down by the mob's rolled resistances. A stronger stagger never
 * shortens one already in progress.
 */
function applyHit(mob: Entity, dirX: number, dirZ: number, knockback: number, stagger: number): void {
  const resist = mob.resist ?? { knockback: 0, stagger: 0 };
  const kb = shoveVelocity(knockback) * (1 - resist.knockback);
  mob.vel!.x = dirX * kb;
  mob.vel!.z = dirZ * kb;
  if (mob.brain) mob.brain.stagger = Math.max(mob.brain.stagger, stagger * (1 - resist.stagger));
}

/**
 * Apply damage to a mob: getting hit always alerts it, and at 0 HP it dies —
 * removed from the world (React unmounts its view via the mobDied event) and
 * its loot hits the ground: the very weapon it was holding (rolled from its
 * spawn pool), so what you see it carry is what it drops.
 */
function damageMob(mob: Entity, amount: number): void {
  if (mob.brain) mob.brain.alerted = true;
  mob.hitFlash = 0.2; // the view flashes the body white — "hit registered"
  emitGameEvent({ type: 'damage', x: mob.pos!.x, z: mob.pos!.z, amount, target: 'mob' });
  if (!mob.health) return;
  mob.health.current -= amount;
  if (mob.health.current > 0) return;

  world.add({
    loot: { weapon: mob.weapon ?? generateWeapon('melee', mob.level ?? 1) },
    pos: { x: mob.pos!.x, z: mob.pos!.z },
  });
  world.remove(mob);
  emitGameEvent({ type: 'mobDied', mob });
}

/**
 * Combat system: the player attacks in the direction they're aiming.
 *
 * Melee: starts a swing — a strike point that sweeps the arc over the swing
 * duration and connects only where the blade actually is (stepMeleeSwings).
 *
 * Ranged: spawns a projectile entity flying along the aim; the projectile
 * system handles the rest.
 */
export function performAttack(): void {
  const player = players.first;
  if (!player?.weapon) return;

  const weapon = player.weapon;
  const aim = player.aim ?? { x: 0, z: 1 };

  if (weapon.kind === 'ranged') {
    world.add({
      projectile: {
        faction: 'player',
        damage: weapon.damage,
        knockback: weapon.knockback,
        stagger: weapon.stagger,
        speed: weapon.speed,
        maxRange: weapon.reach,
        traveled: 0,
        pierce: weapon.pierce,
        struck: [],
      },
      // Muzzle offset: spawn outside the shooter's own body.
      pos: { x: player.pos.x + aim.x * 0.6, z: player.pos.z + aim.z * 0.6 },
      vel: { x: aim.x * weapon.speed, z: aim.z * weapon.speed },
      radius: weapon.hitRadius,
    });
    return;
  }

  startSwing(player, weapon);
}

/** Begin a melee swing — one at a time; the views animate from this state.
 *  The one shared entry point for players and mobs alike. */
function startSwing(attacker: Entity, weapon: { rate: number }): void {
  if (attacker.melee) return;
  attacker.melee = { t: 0, duration: Math.min(0.18, 0.9 / weapon.rate), struck: [] };
}

/**
 * Advance every active melee swing — players and mobs run the IDENTICAL
 * mechanic: the strike point travels the ±70° arc (following the attacker's
 * live aim, like the blade does) at the weapon's reach. A target is hit
 * when the point passes within the strike band of its body — so hits land
 * where and *when* the blade is, and a long weapon can't touch anyone
 * inside its dead zone. Sub-stepped so a fast tip can't skip over a body.
 * The only asymmetry is who the swing tests: the opposing side.
 */
function stepMeleeSwings(delta: number): void {
  for (const attacker of players) advanceSwing(attacker, delta);
  for (const attacker of mobs) advanceSwing(attacker, delta);
}

function advanceSwing(attacker: Entity, delta: number): void {
  const swing = attacker.melee;
  const weapon = attacker.weapon;
  if (!swing || !weapon) return;

  const aim = attacker.aim ?? { x: 0, z: 1 };
  const yaw = Math.atan2(aim.x, aim.z);
  const SUB = 3;

  for (let s = 0; s < SUB && swing.t < swing.duration; s++) {
    swing.t = Math.min(swing.duration, swing.t + delta / SUB);
    const k = swing.t / swing.duration;
    const angle = yaw + (0.5 - k) * 2 * SWING_HALF_ARC_RAD;
    const tx = attacker.pos!.x + Math.sin(angle) * weapon.reach;
    const tz = attacker.pos!.z + Math.cos(angle) * weapon.reach;

    // The opposing side is what the blade can connect with. Collect then
    // apply — damageMob removes the dead mid-iteration otherwise.
    const targets: Entity[] = attacker.player ? [...mobs] : players.first ? [players.first] : [];
    const victims = targets.filter(
      (t) =>
        !swing.struck.includes(t) &&
        Math.hypot(t.pos!.x - tx, t.pos!.z - tz) < MELEE_BAND + (t.radius ?? DEFAULT_RADIUS),
    );
    for (const target of victims) {
      // Shove along the blade's motion (sweep tangent; the sweep runs from
      // +arc to -arc, i.e. clockwise) blended with a radial push-out.
      const dx = target.pos!.x - attacker.pos!.x;
      const dz = target.pos!.z - attacker.pos!.z;
      const rl = Math.hypot(dx, dz) || 1;
      const px = -Math.cos(angle) * 0.6 + (dx / rl) * 0.4;
      const pz = Math.sin(angle) * 0.6 + (dz / rl) * 0.4;
      const pl = Math.hypot(px, pz) || 1;
      swing.struck.push(target);
      if (target.player) {
        damagePlayer(target, weapon.damage, px / pl, pz / pl, weapon.knockback, weapon.stagger);
      } else {
        applyHit(target, px / pl, pz / pl, weapon.knockback, weapon.stagger);
        damageMob(target, weapon.damage);
      }
    }
  }

  if (swing.t >= swing.duration) attacker.melee = undefined;
}

/**
 * Enemy AI system: every mob with a `brain` pathfinds toward the player using
 * rot.js A* over walkable cells and steers toward the route, halting just
 * short for melee. Paths are recomputed a few times a second (cheap for the
 * mob counts here) and followed every frame in between.
 */
function updateEnemyAI(map: GameMap, delta: number): void {
  const player = players.first;
  if (!player) return;

  const pp = player.pos;
  const pCellX = worldToCell(pp.x);
  const pCellZ = worldToCell(pp.z);

  for (const mob of mobs) {
    if (mob.hitFlash) mob.hitFlash = Math.max(0, mob.hitFlash - delta);
    const brain = mob.brain;
    if (!brain) continue;

    // Just got hit — ride out the knockback, decaying it like damping would.
    if (brain.stagger > 0) {
      brain.stagger -= delta;
      const k = Math.exp(-KB_DAMPING * delta);
      mob.vel.x *= k;
      mob.vel.z *= k;
      continue;
    }

    const dist = Math.hypot(pp.x - mob.pos.x, pp.z - mob.pos.z);

    // Perception: notice the player by ear (short radius, through walls) or
    // by eye (longer radius, needs clear line of sight). Latches on.
    if (!brain.alerted) {
      brain.alerted =
        dist <= brain.hearing || (dist <= brain.sight && hasLineOfSight(map, mob.pos, pp));
    }

    // Face the player while alerted — swings sweep around this aim, exactly
    // like the player's sweep around theirs.
    if (brain.alerted && mob.aim && dist > 1e-4) {
      mob.aim.x = (pp.x - mob.pos.x) / dist;
      mob.aim.z = (pp.z - mob.pos.z) / dist;
    }

    // Idle until alerted; hold position once in melee range.
    if (!brain.alerted || dist <= brain.attackRange) {
      mob.vel.x = 0;
      mob.vel.z = 0;
      brain.path = [];
      continue;
    }

    // Periodically recompute the route to the player's current cell.
    brain.repathIn -= delta;
    if (brain.repathIn <= 0 || brain.path.length === 0) {
      brain.repathIn = 0.25;
      brain.path = computePath(map, worldToCell(mob.pos.x), worldToCell(mob.pos.z), pCellX, pCellZ);
    }

    // Steer toward the next waypoint (fall back to a straight line at the player).
    let tx = pp.x;
    let tz = pp.z;
    if (brain.path.length > 0) {
      const next = brain.path[0];
      tx = cellToWorld(next.x);
      tz = cellToWorld(next.z);
      if (Math.hypot(tx - mob.pos.x, tz - mob.pos.z) < 0.25) {
        brain.path.shift();
      }
    }

    const dx = tx - mob.pos.x;
    const dz = tz - mob.pos.z;
    const len = Math.hypot(dx, dz) || 1;
    const speed = mob.moveSpeed ?? MOB_SPEED;
    mob.vel.x = (dx / len) * speed;
    mob.vel.z = (dz / len) * speed;
  }
}

/**
 * Projectile system: fly straight, despawn on obstacle/max-range, damage and
 * shove the first mob hit. ~14 u/s ⇒ ~0.23 u/frame — no substepping needed;
 * meaningfully faster projectiles would need it.
 */
function stepProjectiles(map: GameMap, delta: number): void {
  // Removing entities while iterating an archetype can skip elements —
  // collect despawns and remove after the loop.
  const dead: Entity[] = [];

  for (const p of projectiles) {
    p.pos.x += p.vel.x * delta;
    p.pos.z += p.vel.z * delta;
    p.projectile.traveled += p.projectile.speed * delta;
    const r = p.radius ?? 0.1;

    if (p.projectile.traveled > p.projectile.maxRange || circleOverlapsWall(map, p.pos.x, p.pos.z, r)) {
      dead.push(p);
      continue;
    }

    const s = Math.hypot(p.vel.x, p.vel.z) || 1;

    // Mob bullets test the player; player shots test mobs.
    if (p.projectile.faction === 'mob') {
      const player = players.first;
      if (
        player &&
        Math.hypot(player.pos.x - p.pos.x, player.pos.z - p.pos.z) < r + (player.radius ?? DEFAULT_RADIUS)
      ) {
        damagePlayer(player, p.projectile.damage, p.vel.x / s, p.vel.z / s, p.projectile.knockback, p.projectile.stagger);
        dead.push(p);
      }
      continue;
    }

    // Collect overlapping mobs first (damageMob removes the dead, which
    // isn't safe mid-iteration), then apply. Piercing shots fly on and skip
    // mobs they've already struck.
    const victims: Entity[] = [];
    for (const mob of mobs) {
      if (p.projectile.struck.includes(mob)) continue;
      const dx = mob.pos.x - p.pos.x;
      const dz = mob.pos.z - p.pos.z;
      if (Math.hypot(dx, dz) < r + (mob.radius ?? DEFAULT_RADIUS)) victims.push(mob);
    }
    for (const mob of victims) {
      applyHit(mob, p.vel.x / s, p.vel.z / s, p.projectile.knockback, p.projectile.stagger);
      p.projectile.struck.push(mob);
      damageMob(mob, p.projectile.damage);
    }
    if (victims.length > 0 && !p.projectile.pierce) dead.push(p);
  }

  for (const p of dead) world.remove(p);
}

/** A* over walkable cells; returns the route from (fromX,fromZ) to the target,
 *  excluding the mob's own starting cell. */
function computePath(
  map: GameMap,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
): Array<{ x: number; z: number }> {
  const astar = new ROT.Path.AStar(toX, toZ, (x, z) => !map.isWall(x, z), { topology: 4 });
  const path: Array<{ x: number; z: number }> = [];
  astar.compute(fromX, fromZ, (x, z) => path.push({ x, z }));
  path.shift(); // first cell is where the mob already stands
  return path;
}
