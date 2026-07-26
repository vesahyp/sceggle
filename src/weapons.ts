import * as ROT from 'rot-js';

/**
 * Weapon generation.
 *
 * There are no hardcoded weapons: a weapon is *rolled* from a point budget
 * determined by its level (`weaponBudget`). Points are allocated one at a
 * time to random stats, each riding a linear ramp from its base — so two
 * drops of the same level can play very differently (a fast low-damage
 * roll vs. a slow crushing one). Pierce is a flat 4-point purchase.
 *
 * The prop set:
 * - `damage`     HP removed per hit
 * - `knockback`  shove velocity applied to whatever it hits
 * - `stagger`    seconds the target is stunned (no steering) per hit
 * - `rate`       attacks per second (hold to attack continuously)
 * - `reach`      melee: swing arc range · ranged: max projectile range
 * - `speed`      ranged: projectile flight speed
 * - `hitRadius`  ranged: projectile impact radius
 * - `pierce`     ranged: the projectile passes through mobs it hits
 *
 * Mobs resist knockback and stagger from their own point pool (see
 * App.spawnMobs) — weapon numbers are what lands on a resistance-free
 * target. All randomness goes through ROT.RNG (determinism rule).
 *
 * Names stay generic (`weapon-<kind>-<level>`) until theming; `id` is
 * unique per rolled instance.
 */
export type WeaponKind = 'melee' | 'ranged';

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
  speed: number;
  hitRadius: number;
  pierce: boolean;
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

/** Stat ramps: value = base + points · perPoint. */
type Ramp = { base: number; perPoint: number };
const RAMPS: Record<WeaponKind, Record<string, Ramp>> = {
  melee: {
    damage: { base: 1, perPoint: 0.35 },
    knockback: { base: 2, perPoint: 1.6 },
    stagger: { base: 0.08, perPoint: 0.05 },
    rate: { base: 1.5, perPoint: 0.15 },
    reach: { base: 0.9, perPoint: 0.1 },
  },
  ranged: {
    damage: { base: 1, perPoint: 0.35 },
    knockback: { base: 1, perPoint: 1.2 },
    stagger: { base: 0.06, perPoint: 0.04 },
    rate: { base: 1.5, perPoint: 0.15 },
    reach: { base: 7, perPoint: 0.7 },
    speed: { base: 9, perPoint: 1.0 },
    hitRadius: { base: 0.08, perPoint: 0.015 },
  },
};
const PIERCE_COST = 4;

let serial = 0;

/** Roll a weapon from a point budget (defaults to the level's budget). */
export function generateWeapon(kind: WeaponKind, level: number, budget = weaponBudget(level)): WeaponDef {
  const ramps = RAMPS[kind];
  const keys = Object.keys(ramps);
  if (kind === 'ranged') keys.push('pierce');

  const pts: Record<string, number> = {};
  let pierce = false;
  let pool = budget;
  // Guard bounds the loop even if RNG keeps landing on an unaffordable
  // pierce pick; in practice it exits when the pool runs dry.
  for (let guard = 0; pool > 0 && guard < 500; guard++) {
    const k = keys[ROT.RNG.getUniformInt(0, keys.length - 1)];
    if (k === 'pierce') {
      if (!pierce && pool >= PIERCE_COST) {
        pierce = true;
        pool -= PIERCE_COST;
      }
      continue;
    }
    pts[k] = (pts[k] ?? 0) + 1;
    pool -= 1;
  }

  const v = (key: string) => {
    const r = ramps[key];
    return r.base + (pts[key] ?? 0) * r.perPoint;
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
    speed,
    hitRadius: kind === 'ranged' ? +v('hitRadius').toFixed(2) : 0,
    pierce,
    color: LEVEL_COLORS[Math.min(displayLevel, LEVEL_COLORS.length) - 1],
    // Held-mesh shape follows the roll: reach stretches it, damage fattens it.
    length: kind === 'melee' ? +(0.3 + reach * 0.35).toFixed(2) : +(0.45 + reach * 0.02).toFixed(2),
    thickness: +(0.05 + damage * 0.018).toFixed(3),
  };
}

/** Roll a weapon of either kind, 50/50 (the design's melee/ranged split). */
export function randomWeapon(level: number, budget?: number): WeaponDef {
  return generateWeapon(ROT.RNG.getUniform() < 0.5 ? 'melee' : 'ranged', level, budget);
}
