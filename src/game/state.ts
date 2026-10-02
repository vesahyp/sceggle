import { Rng } from './rng';
import type { Arena } from './arena';
import type { HeroDef } from './content/heroes';
import type { Drop, Effect, Enemy, FloatText, Held, Projectile, RunStats, Turret, Zone } from './types';

export interface HeroStats {
  maxHp: number;
  speed: number;
  /** share of damage taken away, 0..0.75 */
  armor: number;
  reloadMul: number;
  dmgMul: number;
  rangeMul: number;
  bulletSpeedMul: number;
  superRate: number;
  luck: number;
  magnet: number;
  extraAmmo: number;
  pierce: number;
  bounces: number;
  count: number;
  blastMul: number;
  coinMul: number;
}

/** Per-hero input for one step. Aim vectors have length 0..1: the stick's reach. */
export interface HeroInput {
  mx: number;
  my: number;
  /** the aim stick while it is held, for the aim line; fire comes on release */
  aimX: number;
  aimY: number;
  aiming: boolean;
  /** fire this step: along aim if it has length, else at the nearest enemy */
  fire: boolean;
  superAimX: number;
  superAimY: number;
  superAiming: boolean;
  superFire: boolean;
  swap: boolean;
  /** take the gun on the floor under you */
  take: boolean;
}

export const NO_INPUT: HeroInput = { mx: 0, my: 0, aimX: 0, aimY: 0, aiming: false, fire: false, superAimX: 0, superAimY: 0, superAiming: false, superFire: false, swap: false, take: false };

export interface Hero {
  index: number;
  def: HeroDef;
  x: number;
  y: number;
  r: number;
  hp: number;
  alive: boolean;
  /** the angle the hero aims and faces */
  facing: number;
  moving: boolean;
  /** walk animation clock */
  walk: number;
  guns: Held[];
  active: number;
  superCharge: number;
  dash: { t: number; dx: number; dy: number; hit: number[] } | null;
  leap: { sx: number; sy: number; tx: number; ty: number; t: number; dur: number } | null;
  shield: number;
  cogs: Record<string, number>;
  stats: HeroStats;
  invuln: number;
  hurtFlash: number;
  /** seconds since this hero last fired: firing gives away a bush */
  sinceFire: number;
  hidden: boolean;
  swapCd: number;
  valveUsed: boolean;
  afterburn: number;
  /** hits landed, for every-Nth-hit rules */
  hits: number;
  /** seconds since the hero was last hurt */
  calm: number;
  /** the gun drop under the hero, if any */
  near: number | null;
  /** the aim the UI shows: last aim stick state, for the renderer */
  aimShow: { x: number; y: number; on: boolean; superOn: boolean; sx: number; sy: number };
}

export interface Banner {
  text: string;
  sub: string;
  life: number;
  color?: string;
}

export interface SpawnMark {
  kind: string;
  x: number;
  y: number;
  t: number;
  elite: string[];
  boss: number;
}

export type Phase = 'fight' | 'clear' | 'done';

export interface SimState {
  seed: number;
  rng: Rng;
  time: number;
  floorTime: number;
  floor: number;
  arena: Arena;
  heroes: Hero[];
  enemies: Enemy[];
  projectiles: Projectile[];
  zones: Zone[];
  drops: Drop[];
  turrets: Turret[];
  texts: FloatText[];
  effects: Effect[];
  marks: SpawnMark[];
  nextId: number;
  phase: Phase;
  /** waves still to come on this floor, the budget each gets, and the clock */
  wavesLeft: number;
  waveBudget: number;
  waveTimer: number;
  waveSize: number;
  bossFloor: boolean;
  /** seconds the heroes have stood on the open lift */
  liftT: number;
  /** cog picks waiting for the UI, after the lift */
  pendingCogs: number;
  flowTimer: number;
  banner: Banner | null;
  run: RunStats;
  sounds: string[];
  shake: number;
  gameOver: boolean;
  view: { w: number; h: number };
  cam: { x: number; y: number };
  /** slow motion left, seconds: a boss kill and the last kill of a floor */
  slowmo: number;
}

export function createState(seed: number, arena: Arena): SimState {
  return {
    seed,
    rng: new Rng(seed),
    time: 0,
    floorTime: 0,
    floor: 1,
    arena,
    heroes: [],
    enemies: [],
    projectiles: [],
    zones: [],
    drops: [],
    turrets: [],
    texts: [],
    effects: [],
    marks: [],
    nextId: 1,
    phase: 'fight',
    wavesLeft: 0,
    waveBudget: 0,
    waveTimer: 0,
    waveSize: 0,
    bossFloor: false,
    liftT: 0,
    pendingCogs: 0,
    flowTimer: 0,
    banner: null,
    run: { kills: 0, floor: 1, coins: 0, damageDealt: 0, bosses: 0, bestRarity: 0, guns: 0 },
    sounds: [],
    shake: 0,
    gameOver: false,
    view: { w: 420, h: 760 },
    cam: { x: 0, y: 0 },
    slowmo: 0,
  };
}
