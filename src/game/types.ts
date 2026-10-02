import type { Text } from '../i18n';

/** 0 the hero side, 1 the works. Bullets hit the other team only. */
export type Team = 0 | 1;

export type GunType = 'revolver' | 'scatter' | 'rifle' | 'mortar' | 'lance' | 'saw';
export type Maker = 'paukku' | 'kipina' | 'rattaat' | 'heittola' | 'torpeedo' | 'kello';
export type Element = 'none' | 'fire' | 'shock' | 'frost';

/**
 * One gun, rolled (guns.ts). The hero and the enemies hold the same thing
 * and fire it through the same `fireGun`; an enemy gun differs only by the
 * `slow` factor its holder applies to bullet speed.
 */
export interface Gun {
  id: number;
  type: GunType;
  maker: Maker;
  /** 0 grey, 1 green, 2 blue, 3 purple, 4 orange */
  rarity: number;
  /** item level: the floor it was rolled for */
  level: number;
  name: Text;
  /** orange guns: the named rule (content/legendaries.ts) */
  legend: string | null;
  damage: number;
  /** projectiles per shot, fanned across `spread` radians */
  count: number;
  spread: number;
  /** shots per attack, `burstGap` seconds apart */
  burst: number;
  burstGap: number;
  speed: number;
  range: number;
  /** ammo segments, and seconds to refill one */
  ammo: number;
  reload: number;
  /** seconds after an attack before the next can start */
  lockout: number;
  pierce: number;
  bounces: number;
  /** explosion radius on impact, 0 for none */
  blast: number;
  element: Element;
  /** radians per second a shot turns toward the nearest target */
  homing: number;
  /** projectile radius */
  size: number;
}

/** A gun in a hand: the gun plus its ammo and timers. */
export interface Held {
  gun: Gun;
  ammo: number;
  /** reload progress of the next segment, 0..1 */
  refill: number;
  lock: number;
  /** burst shots left to fire, and the angle and aim they go at */
  burstLeft: number;
  burstTimer: number;
  burstAngle: number;
  burstReach: number;
  /** shots fired from this gun, for every-Nth rules */
  shots: number;
}

export interface Projectile {
  id: number;
  team: Team;
  /** the hero index for hero shots, -1 for enemies and the map */
  owner: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  damage: number;
  /** distance left before it drops */
  life: number;
  pierce: number;
  bounces: number;
  blast: number;
  element: Element;
  homing: number;
  /** ids already hit, so a piercing shot hits each body once */
  hit: number[];
  gunType: GunType;
  maker: Maker;
  rarity: number;
  legend: string | null;
  /** mortar: start, target and flight time */
  lob: { sx: number; sy: number; tx: number; ty: number; t: number; dur: number } | null;
  /** saw spin for the renderer */
  spin: number;
  /** shot from a gun with the split rule: break into fragments on impact */
  split: boolean;
  dead: boolean;
}

export type Behaviour = 'swarm' | 'gunner' | 'brute' | 'bomber' | 'mortar' | 'turret' | 'boss';

export interface Enemy {
  id: number;
  kind: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  hp: number;
  maxHp: number;
  speed: number;
  behaviour: Behaviour;
  /** contact damage for melee kinds */
  touch: number;
  held: Held | null;
  /** affixes for elites: names built from them */
  elite: string[];
  boss: boolean;
  /** state machine for windups and charges */
  mode: 'idle' | 'chase' | 'windup' | 'charge' | 'fuse' | 'recover';
  modeT: number;
  /** charge direction */
  cx: number;
  cy: number;
  /** last seen hero position, and seconds since */
  seenX: number;
  seenY: number;
  lostFor: number;
  aware: boolean;
  /** strafe side for gunners, +1 or -1 */
  side: number;
  /** status */
  burn: number;
  burnDps: number;
  slow: number;
  blind: number;
  stun: number;
  flash: number;
  /** knockback velocity, decays */
  kx: number;
  ky: number;
  facing: number;
  /** seconds alive, for animation and spawn-in */
  age: number;
  dead: boolean;
}

export type DropKind = 'coin' | 'steam' | 'gun';

export interface Drop {
  id: number;
  kind: DropKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  value: number;
  gun: Gun | null;
  age: number;
  /** flying to a hero once the floor is clear or a magnet pulls it */
  pull: boolean;
}

/** Ground effects: burning ground, steam vents' puffs, soot clouds, turrets. */
export interface Zone {
  id: number;
  kind: 'fire' | 'soot' | 'steam' | 'shock';
  team: Team;
  owner: number;
  x: number;
  y: number;
  r: number;
  dps: number;
  life: number;
  maxLife: number;
}

export interface Turret {
  id: number;
  owner: number;
  x: number;
  y: number;
  held: Held;
  life: number;
  facing: number;
}

export interface FloatText {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  big: boolean;
}

/** Short-lived drawn things with no rules: blasts, sparks, muzzle flash. */
export interface Effect {
  kind: 'blast' | 'spark' | 'muzzle' | 'puff' | 'ring' | 'chain' | 'telegraph' | 'debris' | 'dash';
  x: number;
  y: number;
  x2: number;
  y2: number;
  r: number;
  color: string;
  life: number;
  maxLife: number;
}

export interface RunStats {
  kills: number;
  floor: number;
  coins: number;
  damageDealt: number;
  bosses: number;
  bestRarity: number;
  guns: number;
}
