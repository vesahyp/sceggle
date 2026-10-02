import { L, type Text } from '../i18n';
import type { Rng } from './rng';
import type { Element, Gun, GunType, Held, Maker } from './types';
import { LEGENDS } from './content/legends';

/**
 * Gun generation: type × maker × rarity. The type is the shape of the shot,
 * the maker is how it behaves, the rarity is how many extra parts it rolled.
 * Nothing here is a fixed roster except the orange guns, which are named
 * (content/legends.ts) and break a rule.
 */

export const GUN_TYPES: GunType[] = ['revolver', 'scatter', 'rifle', 'mortar', 'lance', 'saw'];
export const MAKERS: Maker[] = ['paukku', 'kipina', 'rattaat', 'heittola', 'torpeedo', 'kello'];

export const TYPE_NAME: Record<GunType, Text> = {
  revolver: L('revolveri', 'Revolver'),
  scatter: L('haulikko', 'Scattergun'),
  rifle: L('kivääri', 'Rifle'),
  mortar: L('mörssäri', 'Mortar'),
  lance: L('höyrykeihäs', 'Steam Lance'),
  saw: L('sirkkeli', 'Sawblade'),
};

export const MAKER_INFO: Record<Maker, { name: string; short: string; color: string; rule: Text }> = {
  paukku: { name: 'Paukku & Poika', short: 'Paukku', color: '#c8a26a', rule: L('Iso vahinko, hidas, kaksi lipasta. Ei temppuja.', 'Big damage, slow, two segments. No tricks.') },
  kipina: { name: 'Kipinä', short: 'Kipinä', color: '#5fd0ff', rule: L('Laukauksissa on alkuaine: tuli polttaa, sähkö hyppii, pakkanen hidastaa.', 'Shots carry an element: fire burns, tesla chains, frost slows.') },
  rattaat: { name: 'Rattaanpää', short: 'Ratas', color: '#b0b8c0', rule: L('Jokainen laukaus on sarja.', 'Every shot is a burst.') },
  heittola: { name: 'Heittola', short: 'Heittola', color: '#9be36b', rule: L('Kun ammukset loppuvat, ase heitetään. Se räjähtää ja käteen tulee uusi.', 'When the ammo runs out you throw the gun. It explodes and a fresh one appears.') },
  torpeedo: { name: 'Torpeedo', short: 'Torpeedo', color: '#ff7a3a', rule: L('Jokainen laukaus räjähtää.', 'Every shot explodes.') },
  kello: { name: 'Kellosepät', short: 'Kello', color: '#e8c95a', rule: L('Kellokoneisto kääntää laukauksen kohti vihollista.', 'Clockwork turns each shot toward the enemy.') },
};

export const RARITY_NAME: Text[] = [L('Romu', 'Scrap'), L('Tavallinen', 'Common'), L('Harvinainen', 'Rare'), L('Eepos', 'Epic'), L('Legenda', 'Legendary')];
export const RARITY_COLOR = ['#b8b8b8', '#6ee06e', '#4aa8ff', '#c070ff', '#ff9a2a'];

export const ELEMENT_COLOR: Record<Element, string> = { none: '#ffe9a8', fire: '#ff7a2a', shock: '#7fd8ff', frost: '#bfefff' };

type Base = Omit<Gun, 'id' | 'type' | 'maker' | 'rarity' | 'level' | 'name' | 'legend' | 'element'>;

const BASE: Record<GunType, Base> = {
  revolver: { damage: 24, count: 1, spread: 0, burst: 1, burstGap: 0, speed: 560, range: 300, ammo: 3, reload: 0.95, lockout: 0.32, pierce: 0, bounces: 0, blast: 0, homing: 0, size: 5 },
  scatter: { damage: 10, count: 5, spread: 0.6, burst: 1, burstGap: 0, speed: 500, range: 190, ammo: 3, reload: 1.25, lockout: 0.45, pierce: 0, bounces: 0, blast: 0, homing: 0, size: 4 },
  rifle: { damage: 46, count: 1, spread: 0, burst: 1, burstGap: 0, speed: 860, range: 430, ammo: 3, reload: 1.55, lockout: 0.55, pierce: 1, bounces: 0, blast: 0, homing: 0, size: 4 },
  mortar: { damage: 36, count: 1, spread: 0, burst: 1, burstGap: 0, speed: 0, range: 290, ammo: 3, reload: 1.65, lockout: 0.55, pierce: 0, bounces: 0, blast: 56, homing: 0, size: 8 },
  lance: { damage: 7, count: 7, spread: 0.75, burst: 1, burstGap: 0, speed: 330, range: 130, ammo: 3, reload: 1.05, lockout: 0.4, pierce: 99, bounces: 0, blast: 0, homing: 0, size: 10 },
  saw: { damage: 20, count: 1, spread: 0, burst: 1, burstGap: 0, speed: 380, range: 380, ammo: 3, reload: 1.35, lockout: 0.45, pierce: 2, bounces: 3, blast: 0, homing: 0, size: 9 },
};

const RARITY_MUL = [1, 1.15, 1.32, 1.52, 1.78];
const RARITY_PARTS = [0, 1, 2, 3, 3];

type Part = 'ammo' | 'reload' | 'damage' | 'count' | 'pierce' | 'bounce' | 'range' | 'speed' | 'element' | 'blast';

const PART_PREFIX: Record<Part, Text> = {
  ammo: L('Tilava', 'Roomy'),
  reload: L('Kiireinen', 'Hasty'),
  damage: L('Raskas', 'Heavy'),
  count: L('Monipiippuinen', 'Many-barrelled'),
  pierce: L('Läpäisevä', 'Piercing'),
  bounce: L('Pomppiva', 'Bouncing'),
  range: L('Kaukokantoinen', 'Far-reaching'),
  speed: L('Vinha', 'Swift'),
  element: L('Kiukkuinen', 'Spiteful'),
  blast: L('Räjähtävä', 'Explosive'),
};

const ELEMENT_PREFIX: Record<Element, Text> = { none: L(''), fire: L('Kuuma', 'Hot'), shock: L('Sähköinen', 'Live'), frost: L('Kylmä', 'Cold') };

/** Damage grows a little each floor, so a gun from floor 2 fades by floor 10. */
export function levelMul(level: number): number {
  return 1 + 0.13 * (level - 1);
}

/** Rarity roll for a drop: `luck` shifts weight up the ladder. */
export function rollRarity(rng: Rng, floor: number, luck: number, min = 0): number {
  const w = [60, 30 + floor, 11 + floor * 1.2, 2.5 + floor * 0.5, 0.5 + floor * 0.15].map((x, i) => (i < min ? 0 : x * (i >= 2 ? 1 + luck : 1)));
  return rng.weighted([0, 1, 2, 3, 4], (i) => w[i]);
}

let nextGunId = 1;

export function rollGun(rng: Rng, level: number, rarity: number, opts: { type?: GunType; maker?: Maker; legend?: string } = {}): Gun {
  if (rarity >= 4 && !opts.legend) {
    const pool = Object.keys(LEGENDS).filter((k) => !opts.type || LEGENDS[k].type === opts.type);
    if (pool.length) opts = { ...opts, legend: rng.pick(pool) };
  }
  const legend = opts.legend ? LEGENDS[opts.legend] : null;
  const type = legend?.type ?? opts.type ?? rng.pick(GUN_TYPES);
  const maker = legend?.maker ?? opts.maker ?? rng.pick(MAKERS);
  const g: Gun = { id: nextGunId++, type, maker, rarity, level, name: L(''), legend: opts.legend ?? null, element: 'none', ...BASE[type] };

  // The maker's rule.
  switch (maker) {
    case 'paukku':
      g.damage *= 1.75;
      g.ammo = 2;
      g.reload *= 1.2;
      g.lockout *= 1.15;
      g.size += 1;
      break;
    case 'kipina':
      g.element = rng.pick<Element>(['fire', 'shock', 'frost']);
      g.damage *= 0.9;
      break;
    case 'rattaat':
      g.burst = type === 'scatter' || type === 'lance' ? 2 : rng.int(3, 5);
      g.burstGap = type === 'mortar' ? 0.12 : 0.07;
      g.damage *= type === 'scatter' || type === 'lance' ? 0.6 : 1.25 / g.burst + 0.1;
      g.spread += 0.08;
      break;
    case 'heittola':
      g.ammo += 1;
      g.reload *= 1.1;
      break;
    case 'torpeedo':
      if (!g.blast) g.blast = 30 + (type === 'scatter' || type === 'lance' ? -10 : 0);
      else g.blast *= 1.25;
      g.damage *= type === 'mortar' ? 1.15 : 0.9;
      if (g.speed) g.speed *= 0.72;
      g.reload *= 1.1;
      break;
    case 'kello':
      g.homing = 3.6;
      if (g.speed) g.speed *= 0.8;
      g.damage *= 0.95;
      g.range *= 1.1;
      break;
  }

  // Rarity: a budget multiplier and extra parts.
  g.damage *= RARITY_MUL[rarity] * levelMul(level);
  const parts: Part[] = [];
  const options: Part[] = ['ammo', 'reload', 'damage', 'range', 'speed'];
  if (type === 'scatter' || type === 'lance' || type === 'revolver') options.push('count');
  if (type !== 'mortar' && type !== 'lance') options.push('pierce', 'bounce');
  if (g.element === 'none' && maker !== 'paukku') options.push('element');
  if (type !== 'lance') options.push('blast');
  for (let i = 0; i < RARITY_PARTS[rarity]; i++) {
    const p = rng.pick(options);
    parts.push(p);
    switch (p) {
      case 'ammo':
        g.ammo += 1;
        break;
      case 'reload':
        g.reload *= 0.82;
        break;
      case 'damage':
        g.damage *= 1.22;
        break;
      case 'count':
        g.count += type === 'revolver' ? 1 : 2;
        if (type === 'revolver') g.spread = Math.max(g.spread, 0.18);
        g.damage *= 0.88;
        break;
      case 'pierce':
        g.pierce += 1;
        break;
      case 'bounce':
        g.bounces += 1;
        break;
      case 'range':
        g.range *= 1.25;
        break;
      case 'speed':
        if (g.speed) g.speed *= 1.25;
        g.lockout *= 0.85;
        break;
      case 'element':
        g.element = rng.pick<Element>(['fire', 'shock', 'frost']);
        break;
      case 'blast':
        g.blast = g.blast ? g.blast * 1.25 : 26;
        break;
    }
  }
  if (legend) legend.apply(g);
  g.damage = Math.round(g.damage * 10) / 10;
  g.reload = Math.round(g.reload * 100) / 100;
  g.name = legend ? legend.name : gunName(g, parts);
  return g;
}

function gunName(g: Gun, parts: Part[]): Text {
  const maker = MAKER_INFO[g.maker].short;
  const type = TYPE_NAME[g.type];
  // The part rolled most often names the gun; an element beats it.
  let prefix: Text | null = null;
  if (g.element !== 'none') prefix = ELEMENT_PREFIX[g.element];
  else if (parts.length) {
    const count = new Map<Part, number>();
    for (const p of parts) count.set(p, (count.get(p) ?? 0) + 1);
    const top = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
    prefix = PART_PREFIX[top];
  } else if (g.rarity === 0) prefix = L('Ruosteinen', 'Rusty');
  const fi = `${prefix ? prefix.fi + ' ' : ''}${maker}-${type.fi}`;
  const en = `${prefix ? prefix.en + ' ' : ''}${maker} ${type.en}`;
  return { fi, en };
}

export function hold(gun: Gun): Held {
  return { gun, ammo: gun.ammo, refill: 0, lock: 0, burstLeft: 0, burstTimer: 0, burstAngle: 0, burstReach: 1, shots: 0 };
}

/** Damage per second at a full rhythm, for comparing two guns on a card. */
export function gunDps(g: Gun): number {
  const perShot = g.damage * g.count * g.burst * (g.blast ? 1.4 : 1) * (g.pierce > 0 ? 1 + 0.25 * Math.min(g.pierce, 3) : 1) * (g.element !== 'none' ? 1.15 : 1);
  const cycle = Math.max(g.lockout + (g.burst - 1) * g.burstGap, g.reload);
  return perShot / cycle;
}

/** A rough worth for the bot and for the sort: dps with a nudge for rarity. */
export function gunScore(g: Gun): number {
  return gunDps(g) * (1 + 0.04 * g.rarity) * (g.range > 250 ? 1.1 : 1);
}
