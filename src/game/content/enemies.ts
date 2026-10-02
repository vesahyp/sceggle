import { L, type Text } from '../../i18n';
import type { Behaviour, GunType, Maker } from '../types';

/**
 * The works, come alive. Numbers are for floor 1; sim.ts scales hp and
 * damage with depth. `points` is the wave budget cost; `floor` is the first
 * floor it may appear on.
 */
export interface EnemyDef {
  id: string;
  name: Text;
  behaviour: Behaviour;
  hp: number;
  speed: number;
  r: number;
  /** contact damage (melee kinds), or blast damage for bombers */
  touch: number;
  gun?: { type: GunType; maker?: Maker };
  /** multiplies the gun's damage: enemy guns hit softer than they would in your hand */
  dmgMul: number;
  /** enemy gun: seconds between attacks on top of the gun's own lockout */
  pause: number;
  points: number;
  floor: number;
  /** spawn weight within its budget */
  weight: number;
  /** a share of these carry their gun out as a drop */
  dropGun: number;
  color: string;
}

export const ENEMIES: Record<string, EnemyDef> = {
  rotta: { id: 'rotta', name: L('Ratasrotta', 'Cog Rat'), behaviour: 'swarm', hp: 16, speed: 128, r: 9, touch: 7, dmgMul: 0, pause: 0, points: 1, floor: 1, weight: 4, dropGun: 0, color: '#8a6a4a' },
  niittari: { id: 'niittari', name: L('Niittari', 'Riveter'), behaviour: 'gunner', hp: 40, speed: 78, r: 12, touch: 0, gun: { type: 'revolver' }, dmgMul: 0.42, pause: 0.9, points: 3, floor: 1, weight: 3, dropGun: 0.32, color: '#a87a3a' },
  pajapoika: { id: 'pajapoika', name: L('Pajapoika', 'Forge Boy'), behaviour: 'gunner', hp: 48, speed: 96, r: 12, touch: 0, gun: { type: 'scatter' }, dmgMul: 0.38, pause: 1.1, points: 4, floor: 2, weight: 2.5, dropGun: 0.32, color: '#b04a2a' },
  pommari: { id: 'pommari', name: L('Pommikävelijä', 'Bomb Walker'), behaviour: 'bomber', hp: 24, speed: 112, r: 11, touch: 32, dmgMul: 0, pause: 0, points: 3, floor: 2, weight: 2, dropGun: 0, color: '#3a3a3a' },
  kattilamies: { id: 'kattilamies', name: L('Kattilamies', 'Boiler Brute'), behaviour: 'brute', hp: 190, speed: 66, r: 19, touch: 24, dmgMul: 0, pause: 0, points: 9, floor: 3, weight: 1.4, dropGun: 0, color: '#6a6a72' },
  mortteli: { id: 'mortteli', name: L('Mörssärimiehistö', 'Mortar Crew'), behaviour: 'mortar', hp: 46, speed: 58, r: 13, touch: 0, gun: { type: 'mortar' }, dmgMul: 0.45, pause: 1.6, points: 5, floor: 4, weight: 1.6, dropGun: 0.35, color: '#4a6a4a' },
  torni: { id: 'torni', name: L('Tykkitorni', 'Gun Tower'), behaviour: 'turret', hp: 110, speed: 0, r: 15, touch: 0, gun: { type: 'revolver', maker: 'rattaat' }, dmgMul: 0.32, pause: 1.3, points: 6, floor: 5, weight: 1, dropGun: 0.5, color: '#7a7a6a' },
  kaukoputki: { id: 'kaukoputki', name: L('Kaukoputki', 'Spyglass'), behaviour: 'gunner', hp: 36, speed: 74, r: 11, touch: 0, gun: { type: 'rifle' }, dmgMul: 0.4, pause: 1.4, points: 5, floor: 6, weight: 1.4, dropGun: 0.4, color: '#2a4a6a' },
  kipinakone: { id: 'kipinakone', name: L('Kipinäkone', 'Spark Engine'), behaviour: 'gunner', hp: 60, speed: 84, r: 13, touch: 0, gun: { type: 'saw', maker: 'kipina' }, dmgMul: 0.36, pause: 1.2, points: 6, floor: 8, weight: 1.2, dropGun: 0.4, color: '#3a6a8a' },
};

export interface BossDef {
  id: string;
  name: Text;
  hp: number;
  speed: number;
  r: number;
  touch: number;
  pattern: 'king' | 'mortar' | 'clock' | 'owner';
  color: string;
}

/** One boss every fifth floor, in this order, then round again stronger. */
export const BOSSES: BossDef[] = [
  { id: 'kattilakuningas', name: L('Kattilakuningas', 'The Boiler King'), hp: 1500, speed: 70, r: 30, touch: 30, pattern: 'king', color: '#7a7a82' },
  { id: 'mestarimorssari', name: L('Mestari Mörssäri', 'Master Mortar'), hp: 1700, speed: 55, r: 28, touch: 20, pattern: 'mortar', color: '#4a6a4a' },
  { id: 'kellokoneisto', name: L('Suuri kellokoneisto', 'The Grand Clockwork'), hp: 2000, speed: 40, r: 32, touch: 20, pattern: 'clock', color: '#c8a040' },
  { id: 'tehtailija', name: L('Tehtailija', 'The Mill Owner'), hp: 2400, speed: 80, r: 26, touch: 26, pattern: 'owner', color: '#5a2a3a' },
];

export interface AffixDef {
  name: Text;
  hp: number;
  speed: number;
  dmg: number;
  size: number;
}

/** Elites roll one or two of these; the name is built from them. */
export const AFFIXES: Record<string, AffixDef> = {
  nopea: { name: L('Nopea', 'Swift'), hp: 1, speed: 1.4, dmg: 1, size: 1 },
  panssaroitu: { name: L('Panssaroitu', 'Armoured'), hp: 1.8, speed: 0.9, dmg: 1, size: 1.1 },
  raivo: { name: L('Raivoisa', 'Furious'), hp: 1, speed: 1.1, dmg: 1.5, size: 1 },
  jatti: { name: L('Jättiläis', 'Giant'), hp: 1.5, speed: 0.9, dmg: 1.3, size: 1.4 },
  rajahtava: { name: L('Räjähtävä', 'Volatile'), hp: 1, speed: 1, dmg: 1, size: 1 },
};
