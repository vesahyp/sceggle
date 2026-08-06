import * as ROT from 'rot-js';
import { generateWeapon, weaponBudget, type WeaponDef } from './weapons';

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

export const characterHp = (c: CharacterDef) =>
  Math.round(HP_RAMP.base + c.spend.vigor * HP_RAMP.perPoint);
export const characterSpeed = (c: CharacterDef) =>
  +(SPEED_RAMP.base + c.spend.boots * SPEED_RAMP.perPoint).toFixed(1);
export const characterResist = (c: CharacterDef) => {
  const r = +(c.spend.plating * RESIST_PER_POINT).toFixed(2);
  return { knockback: r, stagger: r };
};

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
 * Roll the archetype's starter gun for a world seed. Seeded on its own
 * stream (same seed + same pick → same gun) and rerolled — bounded — until
 * the archetype predicate and the never-a-dud floors pass: the opening gun
 * has to carry the first horde on its own. Drops keep their spiky rolls;
 * the slot machine starts with the first pickup.
 *
 * The bound looks huge because the roll space is spiky: each `fits` shape
 * lands on only ~1–2% of raw rolls (measured), so 1000 tries is what makes
 * an off-archetype fallback effectively impossible (~1e-6) while a roll
 * itself costs microseconds, once per run start.
 */
export function rollStarterWeapon(c: CharacterDef, seed: number): WeaponDef {
  ROT.RNG.setSeed(seed * 13 + CHARACTERS.indexOf(c));
  const budget = weaponBudget(1) + 4 + c.spend.barrel;
  let w = generateWeapon('ranged', 1, budget);
  for (let i = 0; i < 1000 && !(c.fits(w) && w.damage >= 2 && w.rate >= 0.8); i++) {
    w = generateWeapon('ranged', 1, budget);
  }
  return w;
}
