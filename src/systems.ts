import * as ROT from 'rot-js';
import { world, players, mobs, projectiles, loots, corpses, burners, destructibles, zones, type Entity } from './ecs';
import {
  cellToWorld,
  worldToCell,
  moveCircle,
  circleOverlapsWall,
  overlappingWallCell,
  hasLineOfSight,
  KIND_FLOOR,
  type GameMap,
} from './worldmap';
import type { MechanismDef, WeaponDef } from './weapons';
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

/** Half-thickness of the melee strike band: the blade connects only within
 *  this distance of its sweep radius. Long weapons therefore have a dead
 *  zone up close — a pole can't hit someone hugging you. */
export const MELEE_BAND = 0.55;
/** Ranged aim time before the shot releases (the interruptible window). */
const RANGED_AIM = 0.15;
/** Landed hits freeze the whole sim for a beat (a touch longer on a kill) —
 *  classic hit-stop, so impacts punctuate instead of blending together. */
const HIT_STOP = 0.05;
const HIT_STOP_KILL = 0.09;
let hitStop = 0;
/** Angle between fanned projectiles of a multishot weapon. */
const MULTISHOT_SPREAD = 0.12;

/** View-feedback channel the render layer reads and decays: kills and
 *  detonations pump `shake`, the camera trembles by it. Not sim state. */
export const viewFx = { shake: 0 };

/** Look up an installed mechanism by type. */
const mech = (mechs: MechanismDef[] | undefined, type: MechanismDef['type']) =>
  mechs?.find((m) => m.type === type);

/**
 * Where a hit came from, threaded down to the damage sinks so mechanisms can
 * fire: `mechanisms` drive on-hit effects (scald, chain) and on-kill burst;
 * `from` anchors pull/chain geometry; `chained`/`dot` stop chain-off-chain
 * recursion and per-tick hit-stop spam.
 */
interface HitCtx {
  faction: 'player' | 'mob';
  mechanisms?: MechanismDef[];
  from?: { x: number; z: number };
  chained?: boolean;
  dot?: boolean;
}

/**
 * Detonations queue instead of recursing: a corpse-burst kill can burst the
 * next corpse (the chain-reaction loop), so requests pile up here and drain
 * in one pass per tick — bounded, since each mob dies once.
 */
interface Explosion {
  x: number;
  z: number;
  radius: number;
  damage: number;
  /** Which sides it hurts. Corpse-burst: mobs only. Exploders: both. */
  hitMobs: boolean;
  hitPlayer: boolean;
  /** Mechanisms of the weapon that caused it — kills re-burst, chains carry. */
  mechanisms?: MechanismDef[];
}
const explosionQueue: Explosion[] = [];

function queueExplosion(e: Explosion): void {
  explosionQueue.push(e);
}

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
  // Hit-stop: the whole world holds its breath for a beat after an impact.
  if (hitStop > 0) {
    hitStop -= delta;
    return;
  }
  updateEnemyAI(map, delta);
  stepVolatiles(delta);
  stepSpawners(map, delta);
  stepMobAttacks(map, delta);
  stepAttacks(delta);
  separateMobs();
  for (const e of players) {
    if (e.hitFlash) e.hitFlash = Math.max(0, e.hitFlash - delta);
    if (e.reveal) e.reveal = Math.max(0, e.reveal - delta);
    // Hit-stun: input is ignored (Player view checks `stun`), the shove decays.
    if (e.stun && e.stun > 0) {
      e.stun -= delta;
      const k = Math.exp(-KB_DAMPING * delta);
      e.vel.x *= k;
      e.vel.z *= k;
    }
    moveCircle(map, e.pos, e.vel, e.radius ?? DEFAULT_RADIUS, delta);
  }
  for (const e of mobs) {
    moveCircle(map, e.pos, e.vel, e.radius ?? DEFAULT_RADIUS, delta);
  }
  for (const d of destructibles) {
    if (d.hitFlash) d.hitFlash = Math.max(0, d.hitFlash - delta);
  }
  stepProjectiles(map, delta);
  stepZones(delta);
  tickBurning(delta);
  processExplosions(map);
  stepCorpses(map, delta);
  checkPickups();
  checkExit(map);
}

/**
 * Soft crowd separation: overlapping mobs shove each other's velocity apart
 * so a horde arrives as a mob-shaped wave instead of a single stacked blob.
 * O(n²) over live mobs — fine at horde counts, and only pairs actually
 * overlapping do any work. The player is exempt: bodies never block you.
 */
function separateMobs(): void {
  const arr = [...mobs];
  for (let i = 0; i < arr.length; i++) {
    const a = arr[i];
    const ra = a.radius ?? DEFAULT_RADIUS;
    for (let j = i + 1; j < arr.length; j++) {
      const b = arr[j];
      const minD = ra + (b.radius ?? DEFAULT_RADIUS) + 0.04;
      const dx = b.pos.x - a.pos.x;
      const dz = b.pos.z - a.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= minD * minD) continue;
      const d = Math.sqrt(d2) || 0.01;
      // Push velocity, not position — moveCircle keeps walls authoritative.
      const push = ((minD - d) / minD) * 6;
      const nx = dx / d;
      const nz = dz / d;
      a.vel.x -= nx * push;
      a.vel.z -= nz * push;
      b.vel.x += nx * push;
      b.vel.z += nz * push;
    }
  }
}

/**
 * Exploder behavior: an alerted volatile mob that gets close lights its fuse,
 * plants itself, and detonates — hurting both sides, so a pack of exploders
 * chains. The view reads `lit` to strobe the body as the tell.
 */
function stepVolatiles(delta: number): void {
  const player = players.first;
  for (const mob of [...mobs]) {
    const v = mob.volatile;
    if (!v) continue;
    if (!v.lit) {
      if (
        player &&
        mob.brain?.alerted &&
        Math.hypot(player.pos.x - mob.pos.x, player.pos.z - mob.pos.z) < 1.15
      ) {
        v.lit = true;
      }
      continue;
    }
    // Committed: hold still and count down.
    mob.vel.x = 0;
    mob.vel.z = 0;
    v.fuse -= delta;
    if (v.fuse > 0) continue;
    queueExplosion({
      x: mob.pos.x,
      z: mob.pos.z,
      radius: v.radius,
      damage: v.damage,
      hitMobs: true,
      hitPlayer: true,
    });
    world.remove(mob);
    emitGameEvent({ type: 'mobDied', mob });
  }
}

/**
 * Spawner behavior: while alerted, release one pre-rolled spawnee every
 * `interval` seconds at a clear spot beside the spawner. The entities were
 * generated with the area; the sim just places them and hands them to React
 * to mount (mobsSpawned) — the same ownership split as deaths.
 */
function stepSpawners(map: GameMap, delta: number): void {
  for (const mob of mobs) {
    const s = mob.spawner;
    if (!s || !mob.brain?.alerted) continue;
    s.next -= delta;
    if (s.next > 0) continue;
    s.next = s.interval;
    const child = s.pending.shift();
    if (!child) continue;
    // First open spot on a ring around the spawner.
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const x = mob.pos.x + Math.sin(a) * 1.1;
      const z = mob.pos.z + Math.cos(a) * 1.1;
      if (!circleOverlapsWall(map, x, z, child.radius ?? DEFAULT_RADIUS)) {
        child.pos!.x = x;
        child.pos!.z = z;
        break;
      }
    }
    child.brain!.alerted = true; // born into the fight
    emitGameEvent({ type: 'mobsSpawned', mobs: [child] });
  }
}

/** Ground-fire zones (lob landings): everything of the opposing side inside
 *  the radius takes a damage tick on the interval, no knockback or hit-stop
 *  — area denial you WALK OUT OF, not an impact. Zones expire on `life`. */
function stepZones(delta: number): void {
  for (const z of [...zones]) {
    const s = z.zone;
    s.life -= delta;
    s.next -= delta;
    if (s.next <= 0) {
      s.next += s.interval;
      if (s.faction === 'player') {
        for (const m of [...mobs]) {
          if (Math.hypot(m.pos.x - z.pos.x, m.pos.z - z.pos.z) <= s.radius + (m.radius ?? DEFAULT_RADIUS)) {
            damageMob(m, s.damage, { faction: 'player', dot: true });
          }
        }
      } else {
        const player = players.first;
        if (
          player?.health &&
          player.health.current > 0 &&
          Math.hypot(player.pos.x - z.pos.x, player.pos.z - z.pos.z) <= s.radius + (player.radius ?? DEFAULT_RADIUS)
        ) {
          player.health.current -= s.damage;
          player.hitFlash = 0.15;
          emitGameEvent({ type: 'damage', x: player.pos.x, z: player.pos.z, amount: s.damage, target: 'player' });
          if (player.health.current <= 0) emitGameEvent({ type: 'playerDied' });
        }
      }
    }
    if (s.life <= 0) world.remove(z);
  }
}

/** Scald ticks: burn damage on a timer until the countdown runs out. DoT
 *  skips hit-stop and knockback — it's a state, not an impact. */
function tickBurning(delta: number): void {
  for (const e of [...burners]) {
    const b = e.burning;
    b.until -= delta;
    b.next -= delta;
    if (b.next <= 0) {
      b.next += b.interval;
      if (e.player) {
        if (e.health.current > 0) {
          e.health.current -= b.damage;
          // Emit after the subtraction — the HP readout reads the live value.
          emitGameEvent({ type: 'damage', x: e.pos.x, z: e.pos.z, amount: b.damage, target: 'player' });
          if (e.health.current <= 0) emitGameEvent({ type: 'playerDied' });
        }
      } else {
        damageMob(e, b.damage, { faction: 'player', dot: true });
        if (!world.has(e)) continue; // burned to death
      }
    }
    if (b.until <= 0) world.removeComponent(e, 'burning');
  }
}

/** Attach (or refresh) a scald burn. Queried component — addComponent only. */
function igniteScald(target: Entity, m: MechanismDef): void {
  const damage = 1 + Math.floor(m.power / 3);
  const until = 1.5 + 0.4 * m.power;
  if (target.burning) {
    target.burning.damage = Math.max(target.burning.damage, damage);
    target.burning.until = Math.max(target.burning.until, until);
  } else {
    world.addComponent(target, 'burning', { damage, interval: 0.5, next: 0.5, until });
  }
}

/**
 * Chain lightning: after a hit lands on a mob, arc to the nearest un-hit mob
 * and keep jumping, damage decaying per hop. Player-side only — against a
 * lone player there is nothing to arc to. The chained flag keeps a jump from
 * re-proccing its own chain.
 */
function chainLightning(start: Entity, baseDamage: number, m: MechanismDef, mechs: MechanismDef[]): void {
  const jumps = 1 + Math.floor(m.power / 2);
  const carried = mechs.filter((x) => x.type !== 'chain');
  const struck = new Set<Entity>([start]);
  let cur = start;
  let dmg = baseDamage;
  for (let j = 0; j < jumps; j++) {
    let next: Entity | undefined;
    let bestD = 3.2; // arc range
    for (const other of mobs) {
      if (struck.has(other)) continue;
      const d = Math.hypot(other.pos.x - cur.pos!.x, other.pos.z - cur.pos!.z);
      if (d < bestD) {
        bestD = d;
        next = other;
      }
    }
    if (!next) return;
    dmg = Math.max(1, Math.round(dmg * 0.6));
    emitGameEvent({ type: 'arc', x1: cur.pos!.x, z1: cur.pos!.z, x2: next.pos!.x, z2: next.pos!.z });
    struck.add(next);
    damageMob(next, dmg, { faction: 'player', mechanisms: carried, chained: true });
    cur = next;
  }
}

/**
 * Drain the detonation queue: each explosion shoves and damages everything
 * of the targeted sides within its radius (linear falloff, never below 1),
 * and kills it causes may queue further explosions — processed in the same
 * pass, so chain reactions resolve within the tick.
 */
function processExplosions(map: GameMap): void {
  for (let guard = 0; explosionQueue.length > 0 && guard < 64; guard++) {
    const ex = explosionQueue.shift()!;
    emitGameEvent({ type: 'explosion', x: ex.x, z: ex.z, radius: ex.radius });
    viewFx.shake = Math.min(0.5, viewFx.shake + 0.18);
    hitStop = Math.max(hitStop, HIT_STOP);

    // Blasts break crates and barrels no matter whose they are — a barrel's
    // own death queues the next explosion, so chains resolve this same pass
    // (bounded by the guard). Snapshot: the sink removes the dead.
    for (const d of [...destructibles]) {
      if (Math.hypot(d.pos.x - ex.x, d.pos.z - ex.z) <= ex.radius + 0.5) {
        damageDestructible(map, d, ex.damage);
      }
    }

    if (ex.hitMobs) {
      const victims = [...mobs].filter(
        (m) => Math.hypot(m.pos.x - ex.x, m.pos.z - ex.z) <= ex.radius + (m.radius ?? DEFAULT_RADIUS),
      );
      for (const m of victims) {
        const dx = m.pos.x - ex.x;
        const dz = m.pos.z - ex.z;
        const d = Math.hypot(dx, dz) || 1;
        const dmg = Math.max(1, Math.round(ex.damage * (1 - 0.5 * Math.min(1, d / ex.radius))));
        applyHit(m, dx / d, dz / d, 2.5, 0.25);
        damageMob(m, dmg, { faction: 'player', mechanisms: ex.mechanisms, chained: true });
      }
    }
    if (ex.hitPlayer) {
      const player = players.first;
      if (player) {
        const dx = player.pos.x - ex.x;
        const dz = player.pos.z - ex.z;
        const d = Math.hypot(dx, dz);
        if (d <= ex.radius + (player.radius ?? DEFAULT_RADIUS)) {
          const dn = d || 1;
          const dmg = Math.max(1, Math.round(ex.damage * (1 - 0.5 * Math.min(1, d / ex.radius))));
          damagePlayer(player, dmg, dx / dn, dz / dn, 3, 0.3);
        }
      }
    }
  }
}

/** The destructible entity occupying a grid cell, if any. Linear scan —
 *  tens of entities, deterministic order. */
function destructibleAt(cx: number, cz: number): Entity | undefined {
  for (const d of destructibles) {
    if (d.destructible.cell.x === cx && d.destructible.cell.z === cz) return d;
  }
  return undefined;
}

/** Damage sink for crates and barrels — the destructible counterpart of
 *  damageMob. Death carves the stamped cell back to floor (isWall closes
 *  over the live grid, so collision/LOS/A* honor it the same tick),
 *  detonates a barrel's charge into the queue, and tells React to unmount. */
function damageDestructible(map: GameMap, d: Entity, amount: number): void {
  if (!d.health || !d.pos || !d.destructible || d.health.current <= 0) return; // already breaking
  d.hitFlash = 0.2;
  emitGameEvent({ type: 'damage', x: d.pos.x, z: d.pos.z, amount, target: 'mob' });
  d.health.current -= amount;
  if (d.health.current > 0) return;

  const c = d.destructible.cell;
  map.cells[c.z * map.width + c.x] = 0;
  map.kinds[c.z * map.width + c.x] = KIND_FLOOR;
  if (d.destructible.explosive) {
    // Barrels are indiscriminate, like exploder mobs — both sides burn.
    queueExplosion({
      x: d.pos.x,
      z: d.pos.z,
      radius: d.destructible.explosive.radius,
      damage: d.destructible.explosive.damage,
      hitMobs: true,
      hitPlayer: true,
    });
  }
  world.remove(d);
  emitGameEvent({ type: 'destructibleDied', entity: d });
}

/** Corpses fly out with the killing shove, tumble, and evaporate. They still
 *  slide against walls (moveCircle) so bodies don't sink into rocks. */
function stepCorpses(map: GameMap, delta: number): void {
  for (const c of [...corpses]) {
    c.corpse.t += delta;
    if (c.corpse.t >= c.corpse.life) {
      world.remove(c);
      continue;
    }
    const k = Math.exp(-3 * delta);
    c.vel.x *= k;
    c.vel.z *= k;
    moveCircle(map, c.pos, c.vel, 0.2, delta);
  }
}

/**
 * Mob offense: an alerted, un-staggered mob attacks the player on its
 * weapon's rate — with EXACTLY the player's mechanics. Both kinds start the
 * same windup-telegraphed attack (melee sweeps the strike band, ranged
 * releases its shot when the draw completes). The only mob-specific part is
 * the decision of *when*: melee waits until the target is inside the strike
 * band, so a pole mob won't whiff at someone hugging it.
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

    const dist = Math.hypot(player.pos.x - mob.pos.x, player.pos.z - mob.pos.z) || 1;

    if (weapon.kind === 'melee') {
      if (Math.abs(dist - weapon.reach) > MELEE_BAND + (player.radius ?? DEFAULT_RADIUS)) continue;
    } else {
      if (dist > weapon.reach) continue;
      // Lobbers mortar over whatever's between them and a player they've
      // already noticed; bolts still need the firing line.
      if (weapon.delivery !== 'lob' && !hasLineOfSight(map, mob.pos, player.pos)) continue;
    }
    // Lob shells land where the target WAS at the windup — the lead time is
    // the dodge window.
    mob.aimDist = dist;
    brain.attackIn = 1 / weapon.rate;
    startAttack(mob, weapon);
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
  ctx?: HitCtx,
): void {
  player.hitFlash = 0.2;
  const kb = shoveVelocity(knockback) * PLAYER_KB_FACTOR;
  player.vel!.x = dirX * kb;
  player.vel!.z = dirZ * kb;
  player.stun = Math.min(PLAYER_STUN_CAP, Math.max(player.stun ?? 0, stagger));
  cancelWindup(player);
  hitStop = Math.max(hitStop, HIT_STOP);

  const scald = mech(ctx?.mechanisms, 'scald');
  if (scald) igniteScald(player, scald);

  const h = player.health;
  if (!h || h.current <= 0) return;
  h.current -= amount;
  // Emit AFTER the subtraction: the HP readout reads the live value off the
  // entity when this event lands.
  emitGameEvent({ type: 'damage', x: player.pos!.x, z: player.pos!.z, amount, target: 'player' });
  if (h.current <= 0) emitGameEvent({ type: 'playerDied' });
}

/** Walking over a loot drop collects it into the inventory (App decides
 *  nothing about equipping — grabbing loot mid-fight is always safe). */
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
    if (item.loot!.part) emitGameEvent({ type: 'pickupPart', part: item.loot!.part });
    else emitGameEvent({ type: 'pickup', weapon: item.loot!.weapon! });
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
  cancelWindup(mob);
}

/** A hit interrupts an attack still in its windup — the telegraph is the
 *  window to break it. A strike already sweeping (or a shot already
 *  released) carries through. */
function cancelWindup(entity: Entity): void {
  if (entity.attack && entity.attack.t < entity.attack.windup) entity.attack = undefined;
}

/**
 * Apply damage to a mob: getting hit alerts it AND its packmates nearby
 * (hordes surge together), and at 0 HP it dies — removed from the world
 * (React unmounts its view via the mobDied event), launching a corpse with
 * the killing shove and dropping whatever was pre-rolled at its spawn.
 * On-hit mechanisms (scald, chain) and on-kill ones (burst, a volatile's own
 * charge) fire from the hit context.
 */
function damageMob(mob: Entity, amount: number, ctx: HitCtx): void {
  if (mob.brain && !mob.brain.alerted) {
    mob.brain.alerted = true;
    for (const other of mobs) {
      if (other.brain && Math.hypot(other.pos.x - mob.pos!.x, other.pos.z - mob.pos!.z) < 5) {
        other.brain.alerted = true;
      }
    }
  }
  mob.hitFlash = 0.2; // the view flashes the body white — "hit registered"
  if (!ctx.dot) hitStop = Math.max(hitStop, HIT_STOP);
  emitGameEvent({ type: 'damage', x: mob.pos!.x, z: mob.pos!.z, amount, target: 'mob' });

  const scald = mech(ctx.mechanisms, 'scald');
  if (scald && world.has(mob)) igniteScald(mob, scald);

  if (!mob.health) return;
  const alive = mob.health.current > 0;
  mob.health.current -= amount;

  const chain = mech(ctx.mechanisms, 'chain');
  if (alive && chain && !ctx.chained && ctx.faction === 'player') {
    chainLightning(mob, amount, chain, ctx.mechanisms!);
  }

  if (mob.health.current > 0) return;
  if (!alive) return; // already dying this tick (e.g. hit twice by one blast)
  hitStop = Math.max(hitStop, HIT_STOP_KILL);
  viewFx.shake = Math.min(0.5, viewFx.shake + 0.05);

  // The body flies with the shove the killing blow just applied.
  world.add({
    corpse: {
      t: 0,
      life: 0.85,
      tint: mob.tint ?? '#5fd35f',
      size: 1 + 0.18 * ((mob.level ?? 1) - 1),
      // Deterministic pseudo-random tumble, no RNG stream draw.
      spin: ((mob.pos!.x * 7.13 + mob.pos!.z * 3.71) % (Math.PI * 2)) - Math.PI,
    },
    pos: { x: mob.pos!.x, z: mob.pos!.z },
    vel: { x: mob.vel!.x * 2.2, z: mob.vel!.z * 2.2 },
  });

  if (mob.drops?.weapon || mob.drops?.part) {
    world.add({
      loot: mob.drops.part ? { part: mob.drops.part } : { weapon: mob.drops.weapon },
      pos: { x: mob.pos!.x, z: mob.pos!.z },
    });
  }

  // On-kill detonations: the killer weapon's burst, and a walking bomb's
  // own charge if you pop it before it pops itself.
  const burst = mech(ctx.mechanisms, 'burst');
  if (burst && ctx.faction === 'player') {
    queueExplosion({
      x: mob.pos!.x,
      z: mob.pos!.z,
      radius: 1.3 + 0.18 * burst.power,
      damage: 2 + burst.power,
      hitMobs: true,
      hitPlayer: false,
      mechanisms: ctx.mechanisms,
    });
  }
  if (mob.volatile) {
    queueExplosion({
      x: mob.pos!.x,
      z: mob.pos!.z,
      radius: mob.volatile.radius,
      damage: mob.volatile.damage,
      hitMobs: true,
      hitPlayer: true,
    });
  }

  world.remove(mob);
  emitGameEvent({ type: 'mobDied', mob });
}

/**
 * Combat system: the player attacks in the direction they're aiming. Both
 * kinds go through the shared windup-then-strike attack state — melee sweeps
 * a strike point over the arc, ranged releases its projectiles the moment
 * the draw completes (stepAttacks).
 */
export function performAttack(): void {
  const player = players.first;
  if (!player?.weapon) return;
  startAttack(player, player.weapon);
}

/**
 * Spawn a weapon's shot — the one shared entry point for players and mobs
 * alike. A multishot weapon fires `count` projectiles in a fan centered on
 * the aim.
 */
function fireProjectiles(
  faction: 'player' | 'mob',
  weapon: WeaponDef,
  from: { x: number; z: number },
  dirX: number,
  dirZ: number,
  aimDist?: number,
): void {
  const yaw = Math.atan2(dirX, dirZ);
  const ricochet = mech(weapon.mechanisms, 'ricochet');
  const split = mech(weapon.mechanisms, 'split');
  // A lob lands where the shooter is AIMING (cursor / hunted target),
  // clamped to reach — not at max range. Measured from the muzzle.
  const lob = weapon.delivery === 'lob';
  const range = lob ? Math.max(0.9, Math.min(weapon.reach, aimDist ?? weapon.reach) - 0.6) : weapon.reach;
  for (let i = 0; i < weapon.count; i++) {
    const a = yaw + (i - (weapon.count - 1) / 2) * (weapon.spread ?? MULTISHOT_SPREAD);
    const nx = Math.sin(a);
    const nz = Math.cos(a);
    world.add({
      projectile: {
        faction,
        damage: weapon.damage,
        knockback: weapon.knockback,
        stagger: weapon.stagger,
        speed: weapon.speed,
        maxRange: range,
        traveled: 0,
        pierce: faction === 'player' ? weapon.pierce : false, // vs a single player, pierce is meaningless
        bounces: ricochet ? 1 + Math.floor(ricochet.power / 2) : 0,
        splits: split ? 3 + Math.floor(split.power / 2) : 0,
        blast: weapon.blastRadius,
        lob,
        linger: weapon.linger,
        mechanisms: weapon.mechanisms,
        struck: [],
      },
      // Muzzle offset: spawn outside the shooter's own body.
      pos: { x: from.x + nx * 0.6, z: from.z + nz * 0.6 },
      vel: { x: nx * weapon.speed, z: nz * weapon.speed },
      radius: weapon.hitRadius,
    });
  }
}

/** Shatter a projectile into a ring of weaker fragments at its impact point.
 *  Fragments are plain shots: same faction, half damage, short range, no
 *  further mechanisms — the fun is the burst, not infinite recursion. */
function spawnFragments(p: Entity & { projectile: NonNullable<Entity['projectile']>; pos: { x: number; z: number } }): void {
  const n = p.projectile.splits;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const nx = Math.sin(a);
    const nz = Math.cos(a);
    world.add({
      projectile: {
        faction: p.projectile.faction,
        damage: Math.max(1, Math.round(p.projectile.damage * 0.5)),
        knockback: p.projectile.knockback * 0.5,
        stagger: p.projectile.stagger * 0.5,
        speed: 8,
        maxRange: 3.5,
        traveled: 0,
        pierce: false,
        bounces: 0,
        splits: 0,
        blast: 0,
        lob: false,
        linger: 0,
        mechanisms: [],
        struck: [...p.projectile.struck],
      },
      pos: { x: p.pos.x + nx * 0.15, z: p.pos.z + nz * 0.15 },
      vel: { x: nx * 8, z: nz * 8 },
      radius: p.radius ?? 0.08,
    });
  }
}

/** Begin an attack — one at a time; the views animate from this state.
 *  The one shared entry point for players and mobs, both kinds. The phases
 *  scale with 1/rate, so a slow weapon telegraphs long and sweeps slow —
 *  and the whole attack always fits inside the 1/rate cadence. */
function startAttack(attacker: Entity, weapon: WeaponDef): void {
  if (attacker.attack) return;
  // Attacking gives you away: grass concealment breaks for a beat (both
  // sides set it — one combat path; perception reads the player's).
  attacker.reveal = 1.0;
  attacker.attack =
    weapon.kind === 'melee'
      ? {
          t: 0,
          windup: Math.min(0.45, Math.max(0.12, 0.25 / weapon.rate)),
          duration: Math.min(0.6, Math.max(0.15, 0.55 / weapon.rate)),
          struck: [],
        }
      : {
          // Guns aim fast and RE-ARM slow: the shot leaves early, then the
          // mechanism cranks back over `duration` — the mechanical read.
          t: 0,
          windup: RANGED_AIM,
          duration: Math.min(1.0, Math.max(0.3, 0.5 / weapon.rate)),
          struck: [],
        };
}

/**
 * Blade angle offset from the aim for an in-flight melee attack: winds back
 * to +arc over the telegraph, then sweeps +arc → −arc over the strike. The
 * views draw from this so the blade is exactly where the hits land.
 */
export function bladeAngle(
  swing: { t: number; windup: number; duration: number } | undefined,
  arc: number,
): number {
  if (!swing) return 0;
  if (swing.t <= swing.windup) return (swing.t / swing.windup) * arc;
  return (1 - (2 * (swing.t - swing.windup)) / swing.duration) * arc;
}

/**
 * Advance every active attack — players and mobs run the IDENTICAL
 * mechanic. Ranged: when the windup (the draw) completes, the projectiles
 * release along the attacker's live aim; `duration` is recovery. Melee:
 * after the windup telegraph, the strike point travels the weapon's ±arc
 * (following the attacker's live aim, like the blade does) at the weapon's
 * reach. A target is hit when the point passes within the strike band of
 * its body — so hits land where and *when* the blade is, and a long weapon
 * can't touch anyone inside its dead zone. Sub-stepped so a fast tip can't
 * skip over a body. The only asymmetry is who the swing tests: the
 * opposing side.
 */
function stepAttacks(delta: number): void {
  for (const attacker of players) advanceAttack(attacker, delta);
  for (const attacker of mobs) advanceAttack(attacker, delta);
}

function advanceAttack(attacker: Entity, delta: number): void {
  const swing = attacker.attack;
  const weapon = attacker.weapon;
  if (!swing || !weapon) return;

  const total = swing.windup + swing.duration;

  if (weapon.kind === 'ranged') {
    swing.t = Math.min(total, swing.t + delta);
    if (!swing.fired && swing.t >= swing.windup) {
      swing.fired = true;
      const aim = attacker.aim ?? { x: 0, z: 1 };
      fireProjectiles(attacker.player ? 'player' : 'mob', weapon, attacker.pos!, aim.x, aim.z, attacker.aimDist);
    }
    if (swing.t >= total) attacker.attack = undefined;
    return;
  }

  const aim = attacker.aim ?? { x: 0, z: 1 };
  const yaw = Math.atan2(aim.x, aim.z);
  const SUB = 3;

  for (let s = 0; s < SUB && swing.t < total; s++) {
    swing.t = Math.min(total, swing.t + delta / SUB);
    if (swing.t <= swing.windup) continue; // still telegraphing — can't connect
    const angle = yaw + bladeAngle(swing, weapon.arc);
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
    const ctx: HitCtx = {
      faction: attacker.player ? 'player' : 'mob',
      mechanisms: weapon.mechanisms,
      from: attacker.pos,
    };
    const pull = mech(weapon.mechanisms, 'pull');
    for (const target of victims) {
      // Shove along the blade's motion (sweep tangent; the sweep runs from
      // +arc to -arc, i.e. clockwise) blended with a radial push-out — or,
      // with a pull mechanism installed, yanked back toward the attacker.
      const dx = target.pos!.x - attacker.pos!.x;
      const dz = target.pos!.z - attacker.pos!.z;
      const rl = Math.hypot(dx, dz) || 1;
      let px = -Math.cos(angle) * 0.6 + (dx / rl) * 0.4;
      let pz = Math.sin(angle) * 0.6 + (dz / rl) * 0.4;
      let kb = weapon.knockback;
      if (pull) {
        px = -dx / rl;
        pz = -dz / rl;
        kb = weapon.knockback + pull.power;
      }
      const pl = Math.hypot(px, pz) || 1;
      swing.struck.push(target);
      if (target.player) {
        damagePlayer(target, weapon.damage, px / pl, pz / pl, kb, weapon.stagger, ctx);
      } else {
        applyHit(target, px / pl, pz / pl, kb, weapon.stagger);
        damageMob(target, weapon.damage, ctx);
      }
    }
  }

  if (swing.t >= total) attacker.attack = undefined;
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
    if (mob.reveal) mob.reveal = Math.max(0, mob.reveal - delta);
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
    // by eye — inside the sight distance AND the facing cone AND with clear
    // line of sight. Latches on. Until then, the mob wanders — which is
    // exactly what swings its cone around and makes sneaking dynamic.
    // Grass (Brawl rules): a quiet player standing in grass is invisible to
    // eyes at any range, and grass on the sight line blocks it too — unless
    // the mob is inside grass itself, or the player just fired (`reveal`,
    // which also lets the shot be seen through the bush it came from).
    // Ears don't care. Alerted mobs don't either: the latch is permanent.
    if (!brain.alerted) {
      const aim = mob.aim ?? { x: 0, z: 1 };
      const facing =
        dist > 1e-4 && (aim.x * (pp.x - mob.pos.x) + aim.z * (pp.z - mob.pos.z)) / dist >= Math.cos(brain.fov);
      const revealed = (player.reveal ?? 0) > 0;
      const playerHidden = !revealed && map.isGrass(pCellX, pCellZ);
      const mobInGrass = map.isGrass(worldToCell(mob.pos.x), worldToCell(mob.pos.z));
      brain.alerted =
        dist <= brain.hearing ||
        (dist <= brain.sight &&
          facing &&
          !playerHidden &&
          hasLineOfSight(map, mob.pos, pp, !mobInGrass && !revealed));
      if (!brain.alerted) {
        wander(map, mob, delta);
        continue;
      }
    }

    // Face the player while alerted — swings sweep around this aim, exactly
    // like the player's sweep around theirs.
    if (brain.alerted && mob.aim && dist > 1e-4) {
      mob.aim.x = (pp.x - mob.pos.x) / dist;
      mob.aim.z = (pp.z - mob.pos.z) / dist;
    }

    // Hold position once in attack range.
    if (dist <= brain.attackRange) {
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
 * Idle roaming: every few seconds a mob either rests or strolls to a nearby
 * clear point at a fraction of its speed, facing where it walks — so its
 * vision cone sweeps as it moves. Stationary mobs (spawners) never reach
 * their target, but the rerolls still swing their gaze around like a
 * scanning turret.
 */
function wander(map: GameMap, mob: Entity & { pos: { x: number; z: number }; vel: { x: number; z: number } }, delta: number): void {
  const brain = mob.brain!;
  brain.wanderIn -= delta;
  if (brain.wanderIn <= 0) {
    brain.wanderIn = 2 + ROT.RNG.getUniform() * 3;
    if (ROT.RNG.getUniform() < 0.35) {
      brain.wanderTarget = undefined; // rest a beat
    } else {
      // Posted guards stroll around their anchor (and drift back to it after
      // a shove); free mobs stroll around wherever they stand.
      const anchor = brain.post ?? mob.pos;
      const a = ROT.RNG.getUniform() * Math.PI * 2;
      const d = brain.post ? ROT.RNG.getUniform() * brain.post.radius : 1.5 + ROT.RNG.getUniform() * 2.5;
      const tx = anchor.x + Math.sin(a) * d;
      const tz = anchor.z + Math.cos(a) * d;
      if (!circleOverlapsWall(map, tx, tz, mob.radius ?? DEFAULT_RADIUS)) {
        brain.wanderTarget = { x: tx, z: tz };
      }
    }
  }
  const t = brain.wanderTarget;
  if (!t) {
    mob.vel.x = 0;
    mob.vel.z = 0;
    return;
  }
  const dx = t.x - mob.pos.x;
  const dz = t.z - mob.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.25) {
    brain.wanderTarget = undefined;
    mob.vel.x = 0;
    mob.vel.z = 0;
    return;
  }
  const speed = (mob.moveSpeed ?? MOB_SPEED) * 0.35;
  mob.vel.x = (dx / d) * speed;
  mob.vel.z = (dz / d) * speed;
  if (mob.aim) {
    mob.aim.x = dx / d;
    mob.aim.z = dz / d;
  }
}

/**
 * Projectile system: fly straight, despawn on obstacle/max-range, damage and
 * shove the first mob hit. Sub-stepped so hit tests happen at most ~0.2
 * units apart — spiky speed rolls are fast enough to cross a body in one
 * frame otherwise.
 */
function stepProjectiles(map: GameMap, delta: number): void {
  // Removing entities while iterating an archetype can skip elements —
  // collect despawns and remove after the loop.
  const dead: Entity[] = [];

  for (const p of projectiles) {
    const steps = Math.max(1, Math.ceil((p.projectile.speed * delta) / 0.2));
    for (let i = 0; i < steps; i++) {
      if (stepProjectile(map, p, delta / steps)) {
        dead.push(p);
        break;
      }
    }
  }

  for (const p of dead) world.remove(p);
}

/** One projectile sub-step; returns true when it should despawn. */
function stepProjectile(
  map: GameMap,
  p: Entity & { projectile: NonNullable<Entity['projectile']>; pos: { x: number; z: number }; vel: { x: number; z: number } },
  dt: number,
): boolean {
  const px = p.pos.x;
  const pz = p.pos.z;
  p.pos.x += p.vel.x * dt;
  p.pos.z += p.vel.z * dt;
  p.projectile.traveled += p.projectile.speed * dt;
  const r = p.radius ?? 0.1;

  // Blast shots detonate wherever their flight ends. Faction flags give the
  // Brawl rule for free: your blasts hurt only mobs, theirs only you.
  const detonate = () =>
    queueExplosion({
      x: p.pos.x,
      z: p.pos.z,
      radius: p.projectile.blast,
      damage: p.projectile.damage,
      hitMobs: p.projectile.faction === 'player',
      hitPlayer: p.projectile.faction === 'mob',
      mechanisms: p.projectile.mechanisms,
    });

  if (p.projectile.traveled > p.projectile.maxRange) {
    if (p.projectile.blast > 0) detonate();
    if (p.projectile.linger > 0) {
      // The landing keeps burning: a ground-fire zone the opposing side
      // has to move out of (or never enter).
      world.add({
        zone: {
          faction: p.projectile.faction,
          radius: Math.max(0.8, p.projectile.blast),
          damage: Math.max(1, Math.round(p.projectile.damage * 0.5)),
          interval: 0.45,
          next: 0.15,
          life: p.projectile.linger,
        },
        pos: { x: p.pos.x, z: p.pos.z },
      });
    }
    if (p.projectile.splits > 0) spawnFragments(p);
    return true;
  }

  // Lobbed shells are airborne: nothing on the ground — walls, crates,
  // bodies — touches them. They resolve only where they land (above).
  if (p.projectile.lob) return false;

  const wallCell = overlappingWallCell(map, p.pos.x, p.pos.z, r);
  if (wallCell) {
    // A crate or barrel takes the hit as damage before the shot resolves —
    // either faction breaks them. The shot still dies/bounces here exactly
    // like against rock (a ricochet dents the crate and flies on; a blast
    // shot detonates against it, and the explosion may finish it off).
    const d = destructibleAt(wallCell.x, wallCell.z);
    if (d) damageDestructible(map, d, p.projectile.damage);
    if (p.projectile.bounces > 0) {
      // Ricochet: back out to the pre-step position and reflect on whichever
      // axis (or both, at a corner) the wall was hit along — grid walls are
      // axis-aligned, so axis probes stand in for a surface normal.
      p.projectile.bounces -= 1;
      const hitX = circleOverlapsWall(map, p.pos.x, pz, r);
      const hitZ = circleOverlapsWall(map, px, p.pos.z, r);
      if (hitX || !hitZ) p.vel.x = -p.vel.x;
      if (hitZ || !hitX) p.vel.z = -p.vel.z;
      p.pos.x = px;
      p.pos.z = pz;
      return false;
    }
    p.pos.x = px;
    p.pos.z = pz;
    if (p.projectile.blast > 0) detonate();
    if (p.projectile.splits > 0) spawnFragments(p);
    return true;
  }

  const s = Math.hypot(p.vel.x, p.vel.z) || 1;
  const ctx: HitCtx = { faction: p.projectile.faction, mechanisms: p.projectile.mechanisms };
  const pull = mech(p.projectile.mechanisms, 'pull');

  // Mob bullets test the player; player shots test mobs.
  if (p.projectile.faction === 'mob') {
    const player = players.first;
    if (
      player &&
      Math.hypot(player.pos.x - p.pos.x, player.pos.z - p.pos.z) < r + (player.radius ?? DEFAULT_RADIUS)
    ) {
      if (p.projectile.blast > 0) {
        // The explosion covers the direct target too — damage applies once,
        // and processExplosions supplies the knockback.
        detonate();
      } else {
        // A pulling shot yanks the target back along its own flight path.
        const dir = pull ? -1 : 1;
        const kb = pull ? p.projectile.knockback + pull.power : p.projectile.knockback;
        damagePlayer(player, p.projectile.damage, (dir * p.vel.x) / s, (dir * p.vel.z) / s, kb, p.projectile.stagger, ctx);
      }
      if (p.projectile.splits > 0) spawnFragments(p);
      return true;
    }
    return false;
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
  if (p.projectile.blast > 0) {
    // Blast shots don't damage bodies directly — the detonation covers the
    // point of impact. A piercing blast shot flies through bodies and only
    // detonates at a wall or end of range (deliberate: pierce buys reach
    // through the crowd, blast buys the bang at the end).
    if (victims.length > 0 && !p.projectile.pierce) {
      detonate();
      if (p.projectile.splits > 0) spawnFragments(p);
      return true;
    }
    return false;
  }
  for (const mob of victims) {
    const dir = pull ? -1 : 1;
    const kb = pull ? p.projectile.knockback + pull.power : p.projectile.knockback;
    applyHit(mob, (dir * p.vel.x) / s, (dir * p.vel.z) / s, kb, p.projectile.stagger);
    p.projectile.struck.push(mob);
    damageMob(mob, p.projectile.damage, ctx);
  }
  if (victims.length > 0 && !p.projectile.pierce) {
    if (p.projectile.splits > 0) spawnFragments(p);
    return true;
  }
  return false;
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
