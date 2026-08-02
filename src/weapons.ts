import * as ROT from 'rot-js';

/**
 * Weapon generation.
 *
 * There are no hardcoded weapons: a weapon is *rolled* from a point budget
 * determined by its level (`weaponBudget`). The roll is deliberately spiky:
 * 1–2 randomly chosen *specialty* stats soak about two thirds of the budget,
 * the rest sprinkles uniformly — so same-level drops land as recognizable
 * archetypes (a fast flurry blade, a slow wide sweeper, a sniper bolt)
 * instead of converging on the average. About a third of rolls also *sell*
 * a non-specialty stat below its base (never under half base) to fund the
 * rest. Pierce and extra projectiles are flat point purchases.
 *
 * The prop set:
 * - `damage`     HP removed per hit
 * - `knockback`  shove velocity applied to whatever it hits
 * - `stagger`    seconds the target is stunned (no steering) per hit
 * - `rate`       attacks per second (hold to attack continuously); melee
 *                windup + swing time derive from it, so slow is *visible*
 * - `reach`      melee: swing arc range · ranged: max projectile range
 * - `arc`        melee: swing half-arc in radians (narrow thrust ↔ wide sweep)
 * - `speed`      ranged: projectile flight speed
 * - `hitRadius`  ranged: projectile impact radius
 * - `pierce`     ranged: the projectile passes through mobs it hits
 * - `count`      ranged: projectiles per shot, fired in a fan
 *
 * Mobs resist knockback and stagger from their own point pool (see
 * App.spawnMobs) — weapon numbers are what lands on a resistance-free
 * target. All randomness goes through ROT.RNG (determinism rule).
 *
 * Names stay generic (`weapon-<kind>-<level>`) until theming; `id` is
 * unique per rolled instance.
 */
export type WeaponKind = 'melee' | 'ranged';

/**
 * Mechanisms are the *construction* layer: dropped parts the player installs
 * into a weapon's fitting slots. Unlike stat points, a mechanism changes what
 * an attack DOES — that's where "various ways to kill" comes from. Effects
 * scale with `power`; the behaviors themselves live in systems.ts and are
 * shared by players and mobs (one-combat-system rule — an elite can spawn
 * with one pre-installed).
 *
 * - `chain`     hits arc to nearby enemies (tesla coil)
 * - `scald`     hits ignite a damage-over-time burn (steam scald)
 * - `pull`      hits yank the target toward the attacker (lodestone)
 * - `burst`     kills detonate the corpse, damaging everything around it
 * - `ricochet`  projectiles bounce off obstacles          (ranged only)
 * - `split`     projectiles shatter into fragments on impact (ranged only)
 */
export type MechanismType = 'chain' | 'scald' | 'pull' | 'burst' | 'ricochet' | 'split';

export interface MechanismDef {
  id: string;
  type: MechanismType;
  /** Point power — scales the effect (jumps, burn, radius, fragments…). */
  power: number;
  /** Generic until the theming pass, like weapons. */
  name: string;
  /** Ground-drop + HUD tint, per type. */
  color: string;
  /** Which weapon kinds can host it. */
  kinds: WeaponKind[];
}

const MECHANISM_TYPES: Array<{ type: MechanismType; color: string; kinds: WeaponKind[] }> = [
  { type: 'chain', color: '#7fd4ff', kinds: ['melee', 'ranged'] },
  { type: 'scald', color: '#ff9a3d', kinds: ['melee', 'ranged'] },
  { type: 'pull', color: '#c58fff', kinds: ['melee', 'ranged'] },
  { type: 'burst', color: '#ff5f5f', kinds: ['melee', 'ranged'] },
  { type: 'ricochet', color: '#9fe87f', kinds: ['ranged'] },
  { type: 'split', color: '#ffe07f', kinds: ['ranged'] },
];

/** What a mechanism actually does at its power, in HUD words — shown on the
 *  weapon card and cog tooltips so installing visibly changes the weapon.
 *  The numbers mirror the effect formulas in systems.ts; keep them in sync. */
export function describeMechanism(m: MechanismDef): string {
  switch (m.type) {
    case 'chain': {
      const jumps = 1 + Math.floor(m.power / 2);
      return `hits arc to ${jumps} nearby ${jumps === 1 ? 'foe' : 'foes'}`;
    }
    case 'scald':
      return `hits ignite: ${1 + Math.floor(m.power / 3)} dmg/½s for ${(1.5 + 0.4 * m.power).toFixed(1)}s`;
    case 'pull':
      return 'hits yank the target toward you';
    case 'burst':
      return `kills detonate: ${2 + m.power} dmg in a ${(1.3 + 0.18 * m.power).toFixed(1)} radius`;
    case 'ricochet': {
      const bounces = 1 + Math.floor(m.power / 2);
      return `shots bounce off walls ${bounces}×`;
    }
    case 'split':
      return `shots shatter into ${3 + Math.floor(m.power / 2)} fragments on impact`;
  }
}

/** Roll a mechanism part around the given power tier (±1). */
export function generateMechanism(tier: number): MechanismDef {
  const t = MECHANISM_TYPES[ROT.RNG.getUniformInt(0, MECHANISM_TYPES.length - 1)];
  const power = Math.max(1, tier + ROT.RNG.getUniformInt(-1, 1));
  return {
    id: `cog-${t.type}#${++serial}`,
    type: t.type,
    power,
    name: `cog-${t.type}-${power}`,
    color: t.color,
    kinds: t.kinds,
  };
}

export interface WeaponDef {
  id: string;
  name: string;
  kind: WeaponKind;
  /** Display tier, derived from the budget the roll was given. */
  level: number;
  damage: number;
  knockback: number;
  stagger: number;
  /** Attacks per second. */
  rate: number;
  reach: number;
  /** Melee swing half-arc (radians); 0 for ranged. */
  arc: number;
  speed: number;
  hitRadius: number;
  pierce: boolean;
  /** Projectiles per shot (ranged); 1 for melee. */
  count: number;
  /** Fitting slots — how many mechanisms this weapon can host. */
  slots: number;
  /** Installed mechanisms (construction happens after the roll). */
  mechanisms: MechanismDef[];
  /** Held-mesh tint. */
  color: string;
  /** Held-mesh length. */
  length: number;
  /** Held-mesh thickness. */
  thickness: number;
}

/** Level tints shared by both kinds (placeholder for the rarity ladder). */
const LEVEL_COLORS = ['#cbd5e1', '#7fd4a8', '#7fb2e8', '#e8c97f'];

/** Point pool a weapon of this level is rolled from. */
export const weaponBudget = (level: number) => 6 * level;

/** Inverse of weaponBudget, for labeling rolls given a raw budget. */
const levelForBudget = (budget: number) => Math.max(1, Math.round(budget / 6));

/** Stat ramps: value = base + points · perPoint. Bases are kept small
 *  relative to the ramps on purpose — points must dominate the final value,
 *  or every roll feels like the base weapon with a rounding error. */
type Ramp = { base: number; perPoint: number };
const RAMPS: Record<WeaponKind, Record<string, Ramp>> = {
  melee: {
    damage: { base: 0.5, perPoint: 0.55 },
    knockback: { base: 1, perPoint: 2.0 },
    stagger: { base: 0.1, perPoint: 0.15 },
    rate: { base: 0.8, perPoint: 0.25 },
    reach: { base: 0.8, perPoint: 0.18 },
    arc: { base: 0.6, perPoint: 0.13 },
  },
  ranged: {
    // Guns are the player's ONLY weapon now, so no safety tax — damage
    // tracks close to melee's ramp.
    damage: { base: 0.5, perPoint: 0.5 },
    knockback: { base: 0.5, perPoint: 1.5 },
    stagger: { base: 0.08, perPoint: 0.12 },
    // Guns re-arm slower than blades swing — cranks, boilers, and pawls
    // (the steampunk read) — but a horde demands a workable base cadence.
    rate: { base: 0.8, perPoint: 0.2 },
    reach: { base: 6, perPoint: 0.9 },
    speed: { base: 8, perPoint: 1.0 },
    hitRadius: { base: 0.08, perPoint: 0.02 },
  },
};
const PIERCE_COST = 4;
const MULTISHOT_COST = 3;
const MAX_EXTRA_SHOTS = 2;
/** Share of the pool the specialty stats soak up. */
const SPECIALTY_SHARE = 0.65;
/** Chance a roll sells one non-specialty stat below base to fund the rest. */
const SELL_CHANCE = 0.35;
/** A sold stat never drops below this fraction of its base. */
const SELL_FLOOR = 0.5;

let serial = 0;

/** Roll a weapon from a point budget (defaults to the level's budget). */
export function generateWeapon(kind: WeaponKind, level: number, budget = weaponBudget(level)): WeaponDef {
  const ramps = RAMPS[kind];
  const rampKeys = Object.keys(ramps);

  const pts: Record<string, number> = {};
  let pierce = false;
  let extraShots = 0;
  let pool = budget;

  // Specialties first: 1–2 stats take the lion's share of the budget.
  const specialties = ROT.RNG.shuffle([...rampKeys]).slice(0, ROT.RNG.getUniformInt(1, 2));
  const others = rampKeys.filter((k) => !specialties.includes(k));

  // Maybe hock a non-specialty stat for extra points to spend elsewhere.
  if (ROT.RNG.getUniform() < SELL_CHANCE) {
    const k = others[ROT.RNG.getUniformInt(0, others.length - 1)];
    const sold = ROT.RNG.getUniformInt(1, 2);
    pts[k] = -sold;
    pool += sold;
  }

  for (let dump = Math.round(pool * SPECIALTY_SHARE); dump > 0; dump--) {
    const k = specialties[ROT.RNG.getUniformInt(0, specialties.length - 1)];
    pts[k] = (pts[k] ?? 0) + 1;
    pool -= 1;
  }

  // Remainder sprinkles uniformly; ranged rolls can hit the flat purchases.
  const keys = [...rampKeys];
  if (kind === 'ranged') keys.push('pierce', 'multishot');
  // Guard bounds the loop even if RNG keeps landing on unaffordable flat
  // purchases; in practice it exits when the pool runs dry.
  for (let guard = 0; pool > 0 && guard < 500; guard++) {
    const k = keys[ROT.RNG.getUniformInt(0, keys.length - 1)];
    if (k === 'pierce') {
      if (!pierce && pool >= PIERCE_COST) {
        pierce = true;
        pool -= PIERCE_COST;
      }
      continue;
    }
    if (k === 'multishot') {
      if (extraShots < MAX_EXTRA_SHOTS && pool >= MULTISHOT_COST) {
        extraShots += 1;
        pool -= MULTISHOT_COST;
      }
      continue;
    }
    pts[k] = (pts[k] ?? 0) + 1;
    pool -= 1;
  }

  const v = (key: string) => {
    const r = ramps[key];
    return Math.max(r.base * SELL_FLOOR, r.base + (pts[key] ?? 0) * r.perPoint);
  };
  const displayLevel = levelForBudget(budget);
  const damage = Math.max(1, Math.round(v('damage')));
  const reach = +v('reach').toFixed(1);
  const speed = kind === 'ranged' ? +v('speed').toFixed(1) : 0;

  return {
    id: `${kind}-${displayLevel}#${++serial}`,
    name: `weapon-${kind}-${displayLevel}`,
    kind,
    level: displayLevel,
    damage,
    knockback: +v('knockback').toFixed(1),
    stagger: +v('stagger').toFixed(2),
    rate: +v('rate').toFixed(2),
    reach,
    arc: kind === 'melee' ? +v('arc').toFixed(2) : 0,
    speed,
    hitRadius: kind === 'ranged' ? +v('hitRadius').toFixed(2) : 0,
    pierce,
    count: 1 + extraShots,
    // Fittings grow with tier (rarity will drive this later); rolls come out
    // empty — installing mechanisms is the player's job (or the spawner's,
    // for elite mobs).
    slots: Math.min(4, displayLevel),
    mechanisms: [],
    color: LEVEL_COLORS[Math.min(displayLevel, LEVEL_COLORS.length) - 1],
    // Held-mesh shape follows the roll: reach stretches it, damage fattens it.
    length: kind === 'melee' ? +(0.3 + reach * 0.35).toFixed(2) : +(0.45 + reach * 0.02).toFixed(2),
    thickness: +(0.05 + damage * 0.018).toFixed(3),
  };
}
