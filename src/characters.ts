import { generateWeapon, weaponBudget, type WeaponDef } from './weapons';
import { seedRng } from './rng';

/**
 * Character archetypes — the genre stereotypes a run starts from.
 *
 * Like everything else they are point spends, not bespoke stat blocks: every
 * archetype distributes the same CHARACTER_BUDGET across four ramps —
 * `vigor` (max HP), `boots` (move speed), `plating` (knockback/stagger
 * resist, same component mobs buy), `barrel` (bonus points on the starter
 * gun's roll). The presets are saved builds with a face; a freeform
 * allocation screen can later expose the same spend to the player without
 * touching anything here.
 *
 * The starter gun still ROLLS (seeded → deterministic per world seed +
 * archetype). The archetype only constrains the roll's shape via `fits` —
 * Brawl-style: the pick decides HOW you fight (hug, snipe, shell, swarm),
 * the seed decides the numbers.
 */
export interface CharacterDef {
  id: string;
  name: string;
  /** The stereotype in two words — the card's subtitle. */
  role: string;
  /** What the pick plays like, in HUD words. */
  blurb: string;
  /** The starter gun's archetype, in card words (the roll honors it). */
  gunLine: string;
  /** Body tint — the capsule you steer. */
  tint: string;
  spend: { vigor: number; boots: number; plating: number; barrel: number };
  /** Predicate the starter roll is rerolled against (seeded, bounded). */
  fits: (w: WeaponDef) => boolean;
}

export const CHARACTER_BUDGET = 12;
const HP_RAMP = { base: 18, perPoint: 3 };
const SPEED_RAMP = { base: 4.2, perPoint: 0.3 };
const RESIST_PER_POINT = 0.09;
/** Attack-cadence bonus per `hands` point (a level-up-only ramp — no
 *  archetype starts with it; entity.rateScale = 1 + pts · this). */
export const HANDS_PER_POINT = 0.08;
/** Total plating points (archetype + leveled) stop here — 0.72 resist.
 *  Past that shoves stop being a mechanic at all. */
export const PLATING_CAP = 8;

/**
 * In-run RPG progression: kills pay XP, each level grants ONE point spent by
 * the player on the same ramps the archetypes are built from — a leveled
 * character is a bigger spend of the same budget, so the freeform-allocation
 * idea (see ROADMAP Someday) arrives through play. Deterministic: thresholds
 * and stat values are fixed; the pick is player input, like equipping.
 */
export type StatKey = 'vigor' | 'boots' | 'plating' | 'hands';
export type LevelSpend = Record<StatKey, number>;
export const emptySpend = (): LevelSpend => ({ vigor: 0, boots: 0, plating: 0, hands: 0 });

/** XP a kill pays — level², so an elite is worth a handful of chaff. */
export const xpForKill = (mobLevel: number) => mobLevel * mobLevel;
/** XP needed to clear the given level (consumed on level-up). */
export const xpToNext = (level: number) => 20 + 18 * (level - 1);

export const characterHp = (c: CharacterDef, extra?: LevelSpend) =>
  Math.round(HP_RAMP.base + (c.spend.vigor + (extra?.vigor ?? 0)) * HP_RAMP.perPoint);
export const characterSpeed = (c: CharacterDef, extra?: LevelSpend) =>
  +(SPEED_RAMP.base + (c.spend.boots + (extra?.boots ?? 0)) * SPEED_RAMP.perPoint).toFixed(1);
export const characterResist = (c: CharacterDef, extra?: LevelSpend) => {
  const pts = Math.min(PLATING_CAP, c.spend.plating + (extra?.plating ?? 0));
  const r = +(pts * RESIST_PER_POINT).toFixed(2);
  return { knockback: r, stagger: r };
};
export const characterRateScale = (extra?: LevelSpend) =>
  +(1 + (extra?.hands ?? 0) * HANDS_PER_POINT).toFixed(2);

/** The level-up card copy, per stat — deltas mirror the ramps above. */
export const STAT_PICKS: Array<{ key: StatKey; name: string; effect: string }> = [
  { key: 'vigor', name: 'Vigor', effect: `+${HP_RAMP.perPoint} max HP (and heals ${HP_RAMP.perPoint})` },
  { key: 'boots', name: 'Boots', effect: `+${SPEED_RAMP.perPoint} move speed` },
  { key: 'plating', name: 'Plating', effect: `+${Math.round(RESIST_PER_POINT * 100)}% shove & stun resist` },
  { key: 'hands', name: 'Hands', effect: `+${Math.round(HANDS_PER_POINT * 100)}% attack rate, any gun` },
];

export const CHARACTERS: CharacterDef[] = [
  {
    id: 'bruiser',
    name: 'Bruiser',
    role: 'up-close tank',
    blurb: 'Plated and stubborn — shoves and stuns mostly bounce off. Wants to be inside the horde, not behind it.',
    gunLine: 'close-quarters scattergun',
    tint: '#e07a4f',
    spend: { vigor: 6, boots: 1, plating: 4, barrel: 1 },
    fits: (w) => w.delivery === 'bolt' && w.count >= 2 && w.reach <= 9,
  },
  {
    id: 'sharpshooter',
    name: 'Sharpshooter',
    role: 'glass cannon',
    blurb: 'Folds if anything touches her — nothing gets to. Kills from outside every vision cone on the field.',
    gunLine: 'long-barrel bolt rifle',
    tint: '#4ea1ff',
    spend: { vigor: 2, boots: 2, plating: 0, barrel: 8 },
    fits: (w) => w.delivery === 'bolt' && w.reach >= 9 && w.damage >= 3,
  },
  {
    id: 'artillerist',
    name: 'Artillerist',
    role: 'area denial',
    blurb: 'Fights the floor, not the mob: shells arc over cover and leave it burning. Herds packs into the fire.',
    gunLine: 'shell-lobbing mortar',
    tint: '#a98fe8',
    spend: { vigor: 4, boots: 1, plating: 1, barrel: 6 },
    fits: (w) => w.delivery === 'lob' && w.damage >= 3,
  },
  {
    id: 'skirmisher',
    name: 'Skirmisher',
    role: 'fast harasser',
    blurb: 'Outruns everything that wants to eat him. Peppers on the move, never trades — kiting IS the build.',
    gunLine: 'fast-cranking pepperbox',
    tint: '#ffd166',
    spend: { vigor: 1, boots: 7, plating: 0, barrel: 4 },
    fits: (w) => w.delivery === 'bolt' && w.rate >= 1.4,
  },
];

if (import.meta.env.DEV) {
  for (const c of CHARACTERS) {
    const spent = c.spend.vigor + c.spend.boots + c.spend.plating + c.spend.barrel;
    if (spent !== CHARACTER_BUDGET)
      throw new Error(`character ${c.id} spends ${spent}/${CHARACTER_BUDGET} points`);
  }
}

/**
 * Roll the archetype's starter gun for a world seed. On its own seeded
 * stream (same seed + same pick → same gun) — through seedRng, because the
 * per-archetype seeds are near-sequential and rot.js leaks raw seeds into
 * early draws. Best-of-N among rolls that pass the archetype predicate and
 * the never-a-dud floors, rather than first-to-pass: the shapes land on
 * only ~1–2% of raw rolls (measured), so "stop at the first pass" mostly
 * shipped a barely-passing gun, and the opening gun has to carry the first
 * horde on its own. Drops keep their spiky rolls — the slot machine starts
 * with the first pickup.
 */
export function rollStarterWeapon(c: CharacterDef, seed: number): WeaponDef {
  seedRng(seed * 13 + CHARACTERS.indexOf(c));
  const budget = weaponBudget(1) + 4 + c.spend.barrel;
  const score = (w: WeaponDef) => w.damage * w.rate * w.count;
  let best: WeaponDef | undefined;
  let fallback = generateWeapon('ranged', 1, budget);
  for (let i = 0; i < 1000; i++) {
    const w = generateWeapon('ranged', 1, budget);
    if (c.fits(w) && w.damage >= 2 && w.rate >= 0.8) {
      if (!best || score(w) > score(best)) best = w;
    } else if (score(w) > score(fallback)) fallback = w;
  }
  return best ?? fallback;
}
