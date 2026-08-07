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
import { buildFlowField, flowAt, type FlowField } from './flowfield';
import {
  addDanger,
  addInterest,
  addWallDanger,
  createSteering,
  resetSteering,
  resolveSteering,
  type Steering,
} from './steering';
import {
  chooseIntent,
  driveFor,
  searchPace,
  searchPersistence,
  standoffInner,
} from './utility';
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
/** Angle between fanned projectiles of a multishot weapon. */
const MULTISHOT_SPREAD = 0.12;

/** How far ahead a mob probes for terrain when steering. A bit over a body
 *  width, so it commits to going around a rock before it's scraping it. */
const WALL_LOOKAHEAD = 0.9;
/** Veto strength of a blocked direction — well above any interest, since
 *  walking into a wall is never the answer. */
const WALL_DANGER = 1;
/** How hard a neighbouring body pushes a heading away, at full overlap. */
const CROWD_DANGER = 0.55;
/** Body-radii multiple within which neighbours are worth avoiding. */
const CROWD_RANGE = 2.6;
/** How close counts as reaching a remembered position. */
const SEARCH_ARRIVE = 0.6;
/** Radians/second the cone sweeps while looking around at the spot. */
const SEARCH_SWEEP = 1.8;
/** Seconds spent looking around before giving up, refreshed on every sighting. */
const SEARCH_LOOK = 2.5;
/** Multiple of `sight` a mob can keep tracking a target it has already found.
 *  Noticing someone takes a closer look than not losing them again, and
 *  without the gap a target hovering at the sight edge flickers in and out of
 *  the hunt. Cover still breaks tracking at any range — that's the point of
 *  the mechanic; raw distance shouldn't be the easy out. */
const SIGHT_KEEP = 1.8;

/** Seconds a mob may sit on an unspent turn before it passes to someone
 *  else — otherwise one mob that can't quite close blocks a token forever. */
const TOKEN_HOLD = 2.5;
/** Seconds before a mob that has had its turn may take another. This is the
 *  dial that makes a pack rotate rather than the same front rank swinging. */
const TOKEN_COOLDOWN = 0.7;
/** Multiple of `attackRange` within which a turn is worth spending on a mob.
 *  Wider than the band so a mob can be granted one on approach and arrive
 *  ready to swing, rather than queueing only once it is already in place. */
const TOKEN_RANGE = 1.6;

/* ---------------------------------------------------------------------- *
 * Noise — what the horde hears.
 *
 * Ears differ from eyes in exactly two ways, and this is where both live:
 * sound ignores walls, and it ignores which way a mob is facing. So a noise
 * is nothing but a point and how far it carries.
 *
 * The rule that makes it a mechanic: **a noise points a mob at where the
 * SOUND was, never at where the player is.** You get investigated, not
 * found. Fire from cover and the pack converges on your muzzle flash while
 * you walk away; drop a shell across the yard and they go to the shell.
 *
 * An explosion's flash rides the same event rather than getting its own
 * cone-tested sight check — one bang is one thing to notice, and a second
 * mechanic that read identically would only be a second thing to tune.
 * ---------------------------------------------------------------------- */
interface Noise {
  x: number;
  z: number;
  /** How far it carries for nominal ears (HEARING_REF). */
  radius: number;
}
/** Disturbances raised since the last AI pass; drained by updateEnemyAI. */
const noises: Noise[] = [];

/** The hearing roll a noise radius is quoted against — mobs roll 2.5–4.0,
 *  so sharper ears hear proportionally further than the radius says. */
const HEARING_REF = 3;
/** Speeds bounding the movement-loudness ramp. Shared with the footstep
 *  ripples (scene/Footsteps), so the ring you see IS the noise that carries. */
const QUIET_SPEED = 2.5;
const LOUD_SPEED = 5;
/** What a motionless player still gives away, as a share of a mob's hearing
 *  ring. Not zero — standing on someone's toes is detectable — but small
 *  enough that holding still in cover is a real move. */
const STILL_LOUDNESS = 0.3;

/**
 * How much of its hearing ring a mob gets against a body moving this fast.
 * Standing still is nearly silent, a sprint fills the ring. The renderer
 * draws footstep ripples from the same curve.
 */
export function moveLoudness(speed: number): number {
  const k = Math.min(1, Math.max(0, (speed - QUIET_SPEED) / (LOUD_SPEED - QUIET_SPEED)));
  return STILL_LOUDNESS + (1 - STILL_LOUDNESS) * k;
}

/** What a jet gives away, against a bang of the same numbers. Escaping
 *  gunfire is the steam archetype's whole compensation for having to be at
 *  arm's length: it hisses where a bolt cracks, so a Steamer can work a
 *  flank without calling the rest of the field over. */
const JET_LOUDNESS = 0.35;

/** How far an attack carries. Guns crack, blades swish, steam hisses, and a
 *  shell that is going to detonate announces itself on the way out. */
const attackLoudness = (w: WeaponDef) =>
  w.kind === 'melee' ? 2 : (5 + w.damage * 0.4 + w.blastRadius * 1.5) * (w.delivery === 'jet' ? JET_LOUDNESS : 1);

/** A detonation is the loudest thing on the field, and the one disturbance
 *  that is unmistakably seen as well as heard. */
const explosionLoudness = (radius: number) => 7 + radius * 4;

/** Raise a disturbance at a point. Anything of the horde with ears in range
 *  goes and looks — at the point, not at the player. */
export function emitNoise(x: number, z: number, radius: number): void {
  if (radius > 0) noises.push({ x, z, radius });
}

/** View-feedback channel the render layer reads and decays: kills and
 *  detonations pump `shake`, the camera trembles by it. Not sim state. */
export const viewFx = { shake: 0 };

/**
 * How many mobs may be taking a swing at once. The horde's threat should
 * come from pressure and positioning, not from twenty bodies all resolving
 * an attack on the same frame — which is unreadable and unfair in equal
 * measure. Set per area by `spawnMobs`.
 */
let attackTokens = 3;

export function setAttackTokens(count: number): void {
  attackTokens = Math.max(1, Math.round(count));
}

/**
 * The shared chase field, rooted at the player's cell — one expansion serves
 * every mob (see flowfield.ts). Cached until the player crosses a cell
 * boundary, the area changes, or terrain is carved.
 */
let chaseField: FlowField | undefined;
let chaseFieldMap: GameMap | undefined;

/** Terrain changed under the field (a destructible died and its cell opened),
 *  so the cached expansion is stale. */
export function invalidateFlowField(): void {
  chaseFieldMap = undefined;
}

function ensureChaseField(map: GameMap, goalX: number, goalZ: number): FlowField {
  if (chaseField && chaseFieldMap === map && chaseField.goalX === goalX && chaseField.goalZ === goalZ) {
    return chaseField;
  }
  chaseField = buildFlowField(map, goalX, goalZ, chaseFieldMap === map ? chaseField : undefined);
  chaseFieldMap = map;
  return chaseField;
}

/**
 * Mobs bucketed by world cell, rebuilt each AI tick. Crowd avoidance only
 * cares about bodies within a couple of radii, so a 3×3 bucket lookup beats
 * scanning the whole horde per mob.
 */
type Positioned = Entity & { pos: { x: number; z: number } };
type MobGrid = Map<number, Positioned[]>;

/** Scratch vote maps — steering is resolved one mob at a time inside the AI
 *  tick, so a single instance is reused rather than allocated per mob. */
const steer = createSteering();

function buildMobGrid(): MobGrid {
  const grid: MobGrid = new Map();
  for (const m of mobs) {
    const key = worldToCell(m.pos.z) * 4096 + worldToCell(m.pos.x);
    const bucket = grid.get(key);
    if (bucket) bucket.push(m);
    else grid.set(key, [m]);
  }
  return grid;
}

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
  updateEnemyAI(map, delta);
  assignAttackTokens(delta);
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

/** Scratch queue of mobs waiting for a turn, reused across ticks. */
const tokenQueue: Positioned[] = [];

/**
 * Hand out the area's attack tokens: permission to *start* a swing.
 *
 * Without this every mob that reaches you attacks the moment its own
 * cooldown allows, so a pack resolves as a wall of simultaneous hits — the
 * fight stops being readable and stops being fair, and no amount of tuning
 * individual damage fixes it, because the problem is the count.
 *
 * Holders are recounted from live entities every tick rather than tracked in
 * a counter, so a mob dying mid-swing can't leak a token and slowly starve
 * the horde — a bug that would take a long fight to notice.
 *
 * Runs after `updateEnemyAI` (so `perceives` is current) and before
 * `stepMobAttacks` (which enforces the gate). Steering reacts to the token
 * one frame later, which at 60Hz against a ~1s attack cadence is invisible.
 */
function assignAttackTokens(delta: number): void {
  const player = players.first;
  tokenQueue.length = 0;
  let held = 0;

  for (const mob of mobs) {
    const brain = mob.brain;
    if (!brain) continue;
    if (brain.tokenCool > 0) brain.tokenCool = Math.max(0, brain.tokenCool - delta);

    // Only mobs that could actually swing are worth a turn. Exploders and
    // spawners carry no weapon and never queue — they'd block tokens they
    // can never spend.
    const dist = player ? Math.hypot(player.pos.x - mob.pos.x, player.pos.z - mob.pos.z) : Infinity;
    const eligible =
      !!mob.weapon &&
      brain.perceives &&
      brain.stagger <= 0 &&
      dist <= brain.attackRange * TOKEN_RANGE;

    if (brain.token) {
      brain.tokenHold -= delta;
      // A swing in progress keeps its turn no matter what: passing the token
      // on mid-attack would let a second mob start into the same window,
      // which is the exact pile-on this exists to prevent.
      if (mob.attack || (eligible && brain.tokenHold > 0)) {
        held++;
        continue;
      }
      brain.token = false;
      brain.tokenCool = TOKEN_COOLDOWN;
      continue; // just had a turn — not a candidate for this round
    }

    if (eligible && brain.tokenCool <= 0) tokenQueue.push(mob);
  }

  const free = attackTokens - held;
  if (free <= 0 || tokenQueue.length === 0 || !player) return;

  // Closest first, so the front rank swings while the rest circle — the
  // arrangement that reads as a pack taking turns rather than a queue.
  const pp = player.pos;
  tokenQueue.sort(
    (a, b) =>
      Math.hypot(pp.x - a.pos.x, pp.z - a.pos.z) - Math.hypot(pp.x - b.pos.x, pp.z - b.pos.z),
  );
  for (let i = 0; i < free && i < tokenQueue.length; i++) {
    const brain = tokenQueue[i].brain!;
    brain.token = true;
    brain.tokenHold = TOKEN_HOLD;
  }
}

/**
 * Exploder behavior: a volatile mob that can see or hear the player and gets
 * close lights its fuse,
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
        mob.brain?.perceives &&
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
 * Spawner behavior: while it still remembers the player, release one
 * pre-rolled spawnee every
 * `interval` seconds at a clear spot beside the spawner. The entities were
 * generated with the area; the sim just places them and hands them to React
 * to mount (mobsSpawned) — the same ownership split as deaths.
 */
function stepSpawners(map: GameMap, delta: number): void {
  for (const mob of mobs) {
    const s = mob.spawner;
    if (!s || (mob.brain?.alert ?? 0) <= 0) continue;
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
    // Born into the fight: it inherits the spawner's memory of the player
    // rather than having to find them itself.
    alertTo(child.brain!, mob.brain!.lastSeen?.x ?? mob.pos.x, mob.brain!.lastSeen?.z ?? mob.pos.z);
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
    // The boom: heard (and seen) far past what it burns, by everyone,
    // through everything. Whoever notices comes to the CRATER — which is
    // why a shell landed away from you pulls a pack away from you.
    emitNoise(ex.x, ex.z, explosionLoudness(ex.radius));
    viewFx.shake = Math.min(0.5, viewFx.shake + 0.18);

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
  // The route through here just changed — the cached chase field is stale.
  invalidateFlowField();
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
 * Mob offense: a mob that perceives the player and isn't staggered attacks on its
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
    if (!brain.perceives || brain.stagger > 0 || brain.attackIn > 0 || !brain.token) continue;

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
    brain.attackIn = 1 / (weapon.rate * (mob.rateScale ?? 1));
    startAttack(mob, weapon);
    // Keep the turn until this swing resolves, then it goes back in the pool.
    if (mob.attack) brain.tokenHold = mob.attack.windup + mob.attack.duration;
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
  // `resist` scales the shove and the stun exactly as it does for mobs —
  // it's the same component, bought from the character's point spend.
  const kb =
    shoveVelocity(knockback) * PLAYER_KB_FACTOR * (1 - (player.resist?.knockback ?? 0));
  player.vel!.x = dirX * kb;
  player.vel!.z = dirZ * kb;
  player.stun = Math.min(
    PLAYER_STUN_CAP,
    Math.max(player.stun ?? 0, stagger * (1 - (player.resist?.stagger ?? 0))),
  );
  cancelWindup(player);
  // Getting hit trembles the screen — pain you feel without the sim pausing.
  viewFx.shake = Math.min(0.5, viewFx.shake + 0.1);

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
  // Getting hit tells a mob a DIRECTION, not an address. It turns up the
  // line the hit came from and searches along it — but no further than it
  // could have seen, so a sniper working from outside its sight gets looked
  // toward, not walked to. Its packmates learn nothing from this: what
  // reaches them is the shot's own noise (startAttack), which points at the
  // muzzle rather than at wherever the player has moved to since. That pair
  // used to be one line of telepathy handing twenty brains the player's
  // exact position through walls.
  const attacker = players.first;
  if (mob.brain && mob.pos && attacker && ctx.faction === 'player' && mob.brain.alert < 1) {
    const dx = attacker.pos.x - mob.pos.x;
    const dz = attacker.pos.z - mob.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const look = Math.min(d, mob.brain.sight);
    alertTo(mob.brain, mob.pos.x + (dx / d) * look, mob.pos.z + (dz / d) * look);
  }
  mob.hitFlash = 0.2; // the view flashes and squashes the body — "hit registered"
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
  // …and it is heard. The bang goes off at the MUZZLE, so what the horde
  // learns is where you fired from — stale the moment you move. Only the
  // player's shots are broadcast: nothing in the sim listens for a mob's,
  // and a pack investigating its own gunfire is just twenty mobs walking
  // into each other.
  if (attacker.player && attacker.pos) {
    emitNoise(attacker.pos.x, attacker.pos.z, attackLoudness(weapon));
  }
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
  if (!player) {
    noises.length = 0;
    return;
  }

  const pp = player.pos;
  const pCellX = worldToCell(pp.x);
  const pCellZ = worldToCell(pp.z);
  // How loud the player is right now, as a share of every mob's hearing
  // ring. This is the whole of "standing still is quiet": the ring the view
  // draws around each mob breathes with this same number.
  const loudness = moveLoudness(Math.hypot(player.vel.x, player.vel.z));

  // One expansion out from the player serves the whole horde this tick, and
  // one bucket index serves everyone's crowd avoidance.
  const chase = ensureChaseField(map, pCellX, pCellZ);
  const grid = buildMobGrid();

  for (const mob of mobs) {
    if (mob.hitFlash) mob.hitFlash = Math.max(0, mob.hitFlash - delta);
    if (mob.reveal) mob.reveal = Math.max(0, mob.reveal - delta);
    const brain = mob.brain;
    if (!brain) continue;

    // Ears, part one: disturbances. A shot, a shell landing, a barrel going
    // up. Each sends this mob to the SOUND — walls and facing are irrelevant
    // (that is what makes ears not eyes), and sharper-eared mobs hear
    // further than the radius says. Handled before the stagger bail so a
    // reeling mob still hears the next bang.
    if (noises.length > 0) {
      const ears = brain.hearing / HEARING_REF;
      for (const n of noises) {
        if (Math.hypot(n.x - mob.pos.x, n.z - mob.pos.z) <= n.radius * ears) alertTo(brain, n.x, n.z);
      }
    }

    // Just got hit — ride out the knockback, decaying it like damping would.
    if (brain.stagger > 0) {
      brain.stagger -= delta;
      const k = Math.exp(-KB_DAMPING * delta);
      mob.vel.x *= k;
      mob.vel.z *= k;
      continue;
    }

    const dist = Math.hypot(pp.x - mob.pos.x, pp.z - mob.pos.z);

    // Perception: notice the player by ear (short radius, through walls,
    // scaled by how much noise they are actually making) or by eye — inside
    // the sight distance AND the facing cone AND with clear
    // line of sight. Latches on. Until then, the mob wanders — which is
    // exactly what swings its cone around and makes sneaking dynamic.
    // Grass (Brawl rules): a quiet player standing in grass is invisible to
    // eyes at any range, and grass on the sight line blocks it too — unless
    // the mob is inside grass itself, or the player just fired (`reveal`,
    // which also lets the shot be seen through the bush it came from).
    // Ears don't care. Alerted mobs don't either: the latch is permanent.
    const aim = mob.aim ?? { x: 0, z: 1 };
    const facing =
      dist > 1e-4 && (aim.x * (pp.x - mob.pos.x) + aim.z * (pp.z - mob.pos.z)) / dist >= Math.cos(brain.fov);
    const revealed = (player.reveal ?? 0) > 0;
    const playerHidden = !revealed && map.isGrass(pCellX, pCellZ);
    const mobInGrass = map.isGrass(worldToCell(mob.pos.x), worldToCell(mob.pos.z));
    // Already hunting? Then the eyes reach further — see SIGHT_KEEP.
    const seeRange = brain.alert > 0 ? brain.sight * SIGHT_KEEP : brain.sight;
    brain.perceives =
      dist <= brain.hearing * loudness ||
      (dist <= seeRange &&
        facing &&
        !playerHidden &&
        hasLineOfSight(map, mob.pos, pp, !mobInGrass && !revealed));

    // Memory: perceiving refills it and pins where the player is; failing to
    // perceive drains it. Empty means forgotten — back to wandering.
    if (brain.perceives) {
      alertTo(brain, pp.x, pp.z);
    } else if (brain.alert > 0) {
      brain.alert = Math.max(0, brain.alert - delta / brain.memory);
      if (brain.alert === 0) brain.lastSeen = undefined;
    }

    if (!brain.perceives) {
      if (brain.lastSeen) searchLastSeen(map, mob, grid, delta);
      else wander(map, mob, delta);
      continue;
    }

    // Face the player while hunting — swings sweep around this aim, exactly
    // like the player's sweep around theirs.
    if (mob.aim && dist > 1e-4) {
      mob.aim.x = (pp.x - mob.pos.x) / dist;
      mob.aim.z = (pp.z - mob.pos.z) / dist;
    }

    const toX = dist > 1e-4 ? (pp.x - mob.pos.x) / dist : 0;
    const toZ = dist > 1e-4 ? (pp.z - mob.pos.z) / dist : 1;
    const stand = brain.attackRange;
    const traits = brain.traits;

    // Decide what this mob WANTS before working out which way that is. The
    // scorers live in utility.ts; the traits weighting them were rolled at
    // spawn, which is where "rusher" and "skirmisher" come from.
    resetSteering(steer);
    const crowd = addCrowdDanger(steer, grid, mob);
    const inner = standoffInner(traits);
    brain.intent = chooseIntent(
      traits,
      {
        range: dist / stand,
        health: mob.health ? mob.health.current / mob.health.max : 1,
        allies: crowd.allies,
        hasToken: brain.token,
      },
      inner,
      brain.intent,
    );
    const drive = driveFor(brain.intent, traits);

    // Radial desire: close, give ground, or neither.
    if (drive.toAllies && crowd.allies > 0) {
      addInterest(steer, crowd.centroidX - mob.pos.x, crowd.centroidZ - mob.pos.z, 1);
    } else if (drive.radial > 0) {
      // Follow the shared field toward the player. It has nothing to say when
      // the mob is already in the player's cell or is walled off from them —
      // then just lean at the player and let danger handle the geometry.
      const flow = flowAt(chase, worldToCell(mob.pos.x), worldToCell(mob.pos.z));
      if (flow.x !== 0 || flow.z !== 0) addInterest(steer, flow.x, flow.z, 1);
      else addInterest(steer, toX, toZ, 1);
    } else if (drive.radial < 0) {
      addInterest(steer, -toX, -toZ, 1);
    }

    // Lateral desire: circling, which is what keeps a mob in range from
    // simply standing there.
    if (drive.lateral > 0) {
      addInterest(steer, -toZ * brain.strafe, toX * brain.strafe, drive.lateral);
    }

    // Terrain is what to avoid while doing all that (bodies already voted,
    // above — the crowd survey and the crowd danger are the same scan).
    addWallDanger(steer, map, mob.pos.x, mob.pos.z, mob.radius ?? DEFAULT_RADIUS, WALL_LOOKAHEAD, WALL_DANGER);

    const dir = resolveSteering(steer);
    const speed = mob.moveSpeed ?? MOB_SPEED;
    mob.vel.x = dir.x * speed;
    mob.vel.z = dir.z * speed;
  }

  // Heard by everyone who was going to hear them. A disturbance is an event,
  // not a state: what survives it is the memory it left in a brain.
  noises.length = 0;
}

/**
 * One pass over a mob's neighbours doing two jobs: bodies push a heading
 * away (hardest when touching), and the same scan reports who's around so
 * the utility layer can tell an isolated mob from one in a pack.
 *
 * This is the anticipatory half of crowd handling — `separateMobs` still
 * resolves actual overlap after the fact, but steering around a neighbour
 * beforehand is what makes a pack fan out instead of piling into one lane.
 */
interface CrowdSurvey {
  allies: number;
  centroidX: number;
  centroidZ: number;
}
const crowdSurvey: CrowdSurvey = { allies: 0, centroidX: 0, centroidZ: 0 };

function addCrowdDanger(steer: Steering, grid: MobGrid, mob: Positioned): CrowdSurvey {
  const cx = worldToCell(mob.pos.x);
  const cz = worldToCell(mob.pos.z);
  const reach = (mob.radius ?? DEFAULT_RADIUS) * CROWD_RANGE;
  let allies = 0;
  let sumX = 0;
  let sumZ = 0;
  for (let z = cz - 1; z <= cz + 1; z++) {
    for (let x = cx - 1; x <= cx + 1; x++) {
      const bucket = grid.get(z * 4096 + x);
      if (!bucket) continue;
      for (const other of bucket) {
        if (other === mob) continue;
        const dx = other.pos.x - mob.pos.x;
        const dz = other.pos.z - mob.pos.z;
        const d = Math.hypot(dx, dz);
        // Company is counted over the whole 3×3 lookup; only bodies close
        // enough to collide with are worth steering around.
        allies++;
        sumX += other.pos.x;
        sumZ += other.pos.z;
        if (d >= reach || d < 1e-4) continue;
        addDanger(steer, dx, dz, CROWD_DANGER * (1 - d / reach));
      }
    }
  }
  crowdSurvey.allies = allies;
  crowdSurvey.centroidX = allies > 0 ? sumX / allies : mob.pos.x;
  crowdSurvey.centroidZ = allies > 0 ? sumZ / allies : mob.pos.z;
  return crowdSurvey;
}

/**
 * Pin a point in a mob's memory and refill its alertness — the one way
 * anything gets a mob's attention. Perception passes the player's actual
 * position; ears pass where the sound was; a hit passes a point up the line
 * it came from. The mob can't tell the difference, which is the mechanic:
 * it goes and looks, and being wrong costs it the walk.
 */
function alertTo(brain: NonNullable<Entity['brain']>, x: number, z: number): void {
  brain.alert = 1;
  brain.searchLook = SEARCH_LOOK * searchPersistence(brain.traits);
  if (brain.lastSeen) {
    brain.lastSeen.x = x;
    brain.lastSeen.z = z;
  } else {
    brain.lastSeen = { x, z };
  }
}

/**
 * Search: walk to where the player was last perceived, then stand there and
 * sweep the cone around before giving up. This is the half of perception
 * that makes cover worth using — the pack commits to a stale position, and
 * the time it spends checking it is time you spent moving somewhere else.
 *
 * The walk steers straight at the remembered spot rather than following a
 * field. It can afford to: the mob recorded that spot while it had clear
 * line of sight to it, and a clear line is by definition walkable. Terrain
 * danger covers the rest (a shove mid-chase, or a spot heard through a
 * wall), and a mob that can't get there simply runs out of `alert` and
 * forgets — which is the right outcome anyway.
 */
function searchLastSeen(
  map: GameMap,
  mob: Entity & { pos: { x: number; z: number }; vel: { x: number; z: number } },
  grid: MobGrid,
  delta: number,
): void {
  const brain = mob.brain!;
  const target = brain.lastSeen!;
  const dx = target.x - mob.pos.x;
  const dz = target.z - mob.pos.z;

  if (Math.hypot(dx, dz) > SEARCH_ARRIVE) {
    resetSteering(steer);
    addInterest(steer, dx, dz, 1);
    addCrowdDanger(steer, grid, mob);
    addWallDanger(steer, map, mob.pos.x, mob.pos.z, mob.radius ?? DEFAULT_RADIUS, WALL_LOOKAHEAD, WALL_DANGER);
    const dir = resolveSteering(steer);
    // Advancing on a guess, not charging a target — the slower approach is
    // also the tell that it has lost you. How much slower is the mob's own
    // aggression: some push straight in, some creep.
    const speed = (mob.moveSpeed ?? MOB_SPEED) * searchPace(brain.traits);
    mob.vel.x = dir.x * speed;
    mob.vel.z = dir.z * speed;
    if (mob.aim && (dir.x !== 0 || dir.z !== 0)) {
      mob.aim.x = dir.x;
      mob.aim.z = dir.z;
    }
    return;
  }

  // Arrived at nothing. Stand and sweep — which is also what gives the
  // player a readable window to slip past a cone that's pointed elsewhere.
  mob.vel.x = 0;
  mob.vel.z = 0;
  brain.searchLook -= delta;
  if (mob.aim) {
    const a = SEARCH_SWEEP * delta * brain.strafe;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const nx = mob.aim.x * cos - mob.aim.z * sin;
    mob.aim.z = mob.aim.x * sin + mob.aim.z * cos;
    mob.aim.x = nx;
  }
  if (brain.searchLook <= 0) {
    brain.alert = 0;
    brain.lastSeen = undefined;
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
