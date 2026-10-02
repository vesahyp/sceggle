/**
 * `npm run sim-check`: behavioural checks on the real sim, headless.
 *
 * Part one is a gun table: every type x maker at rarity 1 and 3, level 1,
 * from a fixed seed, so a change to guns.ts shows its effect on dps at a
 * glance. Part two is a list of PASS/FAIL assertions on things a green
 * build cannot see: arenas are walkable end to end, enemies never spawn
 * inside a wall, a gun actually hurts what it is aimed at, enemy bullets
 * are the slow kind, a floor completes, the lift waits for the waves, a
 * gun pickup swaps correctly, and a seed replays identically.
 */
declare const process: { argv: string[]; exitCode?: number };

import { generateArena, hitsSolid, idxAt, PIT, solidMove, WALL, type Arena } from '../src/game/arena';
import { HERO_BY_ID } from '../src/game/content/heroes';
import { GUN_TYPES, MAKERS, gunDps, hold, rollGun } from '../src/game/guns';
import { Rng } from '../src/game/rng';
import { DT, newRun, step } from '../src/game/sim';
import { NO_INPUT } from '../src/game/state';
import type { Enemy } from '../src/game/types';
import { fireBursts, tryAttack, type Shooter } from '../src/game/weapons';
import { t } from '../src/i18n';
import { botInput } from './autoplayer';

let fails = 0;
const check = (name: string, ok: boolean, extra = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};

const bot = (seed: number) => new Rng(seed ^ 0x5151);

// ————— part one: the gun table —————

function gunTable(): void {
  console.log('type       maker       rarity  name                           dps    dmg   cnt burst ammo reload range');
  const rng = new Rng(20261002);
  for (const type of GUN_TYPES) {
    for (const maker of MAKERS) {
      for (const rarity of [1, 3]) {
        const g = rollGun(rng, 1, rarity, { type, maker });
        console.log(
          `${type.padEnd(10)} ${maker.padEnd(11)} ${String(rarity).padStart(6)}  ${t(g.name).padEnd(30)} ${gunDps(g).toFixed(1).padStart(5)} ${g.damage.toFixed(1).padStart(6)} ${String(g.count).padStart(4)} ${String(g.burst).padStart(5)} ${String(g.ammo).padStart(4)} ${g.reload.toFixed(2).padStart(6)} ${g.range.toFixed(0).padStart(6)}`,
        );
      }
    }
  }
}

// ————— part two: assertions —————

/** BFS over walkable tiles only, same rule the sim walks by. */
function reachable(a: Arena, fromIdx: number, toIdx: number): boolean {
  const seen = new Uint8Array(a.w * a.h);
  const q = [fromIdx];
  seen[fromIdx] = 1;
  while (q.length) {
    const i = q.pop()!;
    if (i === toIdx) return true;
    const x = i % a.w;
    for (const j of [x > 0 ? i - 1 : -1, x < a.w - 1 ? i + 1 : -1, i - a.w, i + a.w]) {
      if (j < 0 || j >= a.w * a.h || seen[j]) continue;
      if (solidMove(a.tiles[j])) continue;
      seen[j] = 1;
      q.push(j);
    }
  }
  return false;
}

/** A walkable tile with WALL on both opposite sides traps anything wider than one tile. Mirrors arena.ts's hasWallPinch. */
function hasWallPinch(a: Arena): boolean {
  for (let y = 1; y < a.h - 1; y++) {
    for (let x = 1; x < a.w - 1; x++) {
      const i = y * a.w + x;
      if (a.tiles[i] === WALL || a.tiles[i] === PIT) continue;
      if (a.tiles[i - 1] === WALL && a.tiles[i + 1] === WALL) return true;
      if (a.tiles[i - a.w] === WALL && a.tiles[i + a.w] === WALL) return true;
    }
  }
  return false;
}

function checkArenas(): void {
  let badConnect = 0;
  let badPinch = 0;
  let total = 0;
  for (let floor = 1; floor <= 30; floor++) {
    const boss = floor % 5 === 0;
    for (let seed = 1; seed <= 20; seed++) {
      total++;
      const a = generateArena(seed, floor, boss);
      if (!reachable(a, idxAt(a, a.startX, a.startY), idxAt(a, a.liftX, a.liftY))) badConnect++;
      if (hasWallPinch(a)) badPinch++;
    }
  }
  check('every arena (floors 1-30, seeds 1-20) is walkable from start to lift', badConnect === 0, `${badConnect} of ${total} not connected`);
  check('no arena has a one-tile WALL pinch', badPinch === 0, `${badPinch} of ${total} pinched`);
}

function checkEnemySpawnsNotSolid(): void {
  let checked = 0;
  let stuck = 0;
  for (let seed = 1; seed <= 5; seed++) {
    const s = newRun(seed, [HERO_BY_ID.konemestari]);
    const rng = bot(seed);
    // Check every step, while the floor is in play: once it clears, the
    // enemy list empties and there is nothing left to check.
    for (let i = 0; i < 60 * 25 && s.floor === 1 && s.phase === 'fight'; i++) {
      step(s, [botInput(s, s.heroes[0], rng)], DT);
      for (const e of s.enemies) {
        checked++;
        if (hitsSolid(s.arena, e.x, e.y, e.r)) stuck++;
      }
    }
  }
  check('a wave never spawns an enemy inside a solid tile', stuck === 0, `${stuck} of ${checked} enemy-steps inside a wall`);
}

function checkFireDamagesEnemy(): void {
  const s = newRun(6, [HERO_BY_ID.konemestari]);
  const h = s.heroes[0];
  const target: Enemy = {
    id: 999001,
    kind: 'rotta',
    x: h.x,
    y: h.y - 100,
    vx: 0,
    vy: 0,
    r: 9,
    hp: 5000,
    maxHp: 5000,
    speed: 0,
    behaviour: 'swarm',
    touch: 0,
    held: null,
    elite: [],
    boss: false,
    mode: 'chase',
    modeT: 0,
    cx: 0,
    cy: 0,
    seenX: h.x,
    seenY: h.y - 100,
    lostFor: 0,
    aware: true,
    side: 1,
    burn: 0,
    burnDps: 0,
    slow: 0,
    blind: 0,
    stun: 0,
    flash: 0,
    kx: 0,
    ky: 0,
    facing: 0,
    age: 10,
    dead: false,
  };
  s.enemies.push(target);
  for (let i = 0; i < 60 * 3; i++) step(s, [{ ...NO_INPUT, fire: true }], DT);
  check('a hero standing still, firing with auto-aim, damages an enemy in sight', target.hp < 5000, `hp ${target.hp.toFixed(0)} of 5000`);
}

function checkEnemyBulletsSlower(): void {
  const s = newRun(7, [HERO_BY_ID.konemestari]);
  const gun = rollGun(new Rng(5), 1, 2, { type: 'revolver', maker: 'paukku' });
  const heroSh: Shooter = { x: 0, y: 0, team: 0, owner: 0, dmgMul: 1, slow: 1, hero: null };
  const enemySh: Shooter = { x: 0, y: 0, team: 1, owner: -1, dmgMul: 1, slow: 0.5, hero: null };
  const heroHeld = hold(gun);
  const enemyHeld = hold(gun);
  tryAttack(s, heroSh, heroHeld, 0, 1);
  fireBursts(s, heroSh, heroHeld, 0);
  tryAttack(s, enemySh, enemyHeld, 0, 1);
  fireBursts(s, enemySh, enemyHeld, 0);
  const heroSpeed = Math.hypot(s.projectiles.find((p) => p.team === 0)!.vx, s.projectiles.find((p) => p.team === 0)!.vy);
  const enemySpeed = Math.hypot(s.projectiles.find((p) => p.team === 1)!.vx, s.projectiles.find((p) => p.team === 1)!.vy);
  check('an enemy bullet from the same gun flies slower than a hero bullet', enemySpeed < heroSpeed, `hero ${heroSpeed.toFixed(0)} enemy ${enemySpeed.toFixed(0)}`);
}

function checkFloorCompletes(): void {
  const s = newRun(1, [HERO_BY_ID.konemestari]);
  const rng = bot(1);
  let steps = 0;
  const max = Math.round(90 / DT);
  while (s.phase !== 'done' && steps < max) {
    step(s, [botInput(s, s.heroes[0], rng)], DT);
    steps++;
  }
  check('seed 1, konemestari, reaches phase "done" on floor 1 within 90s', s.phase === 'done' && s.floor === 1, `phase ${s.phase} floor ${s.floor} time ${s.time.toFixed(1)}s`);
}

function checkLiftGate(): void {
  const s = newRun(3, [HERO_BY_ID.seppa]);
  const h = s.heroes[0];
  h.invuln = 999; // a dead hero would end the run and confuse the result; the gate is the thing under test, not survival
  h.x = s.arena.liftX;
  h.y = s.arena.liftY;
  for (let i = 0; i < 90; i++) step(s, [NO_INPUT], DT); // 1.5s: waves are still due, enemies may already be on the way
  const openedEarly = s.phase !== 'fight';
  s.wavesLeft = 0;
  s.enemies = [];
  s.marks = [];
  for (let i = 0; i < 180; i++) step(s, [NO_INPUT], DT); // 3s: enough for the floor to clear and the lift to open
  check('the lift opens only after every wave is cleared', !openedEarly && s.phase === 'done', `opened early: ${openedEarly}, phase after clear: ${s.phase}`);
}

function checkGunPickupSwap(): void {
  const s = newRun(4, [HERO_BY_ID.nuohooja]);
  const h = s.heroes[0];
  const gunA = rollGun(new Rng(10), 1, 1, { type: 'rifle', maker: 'kello' });
  s.drops.push({ id: 90001, kind: 'gun', x: h.x, y: h.y, vx: 0, vy: 0, value: 0, gun: gunA, age: 1, pull: false });
  step(s, [{ ...NO_INPUT, take: true }], DT);
  const tookSecond = h.guns.length === 2 && h.guns[1].gun === gunA;

  const gunB = rollGun(new Rng(11), 1, 1, { type: 'saw', maker: 'torpeedo' });
  s.drops.push({ id: 90002, kind: 'gun', x: h.x, y: h.y, vx: 0, vy: 0, value: 0, gun: gunB, age: 1, pull: false });
  const oldGun = h.guns[h.active].gun;
  step(s, [{ ...NO_INPUT, take: true }], DT);
  const swappedIn = h.guns.length === 2 && h.guns[h.active].gun === gunB;
  const droppedOld = s.drops.some((d) => d.gun === oldGun);
  check('picking up a gun with two already held swaps it in and drops the old one', tookSecond && swappedIn && droppedOld, `tookSecond ${tookSecond} swappedIn ${swappedIn} droppedOld ${droppedOld}`);
}

function checkDeterminism(): void {
  const run = () => {
    const s = newRun(42, [HERO_BY_ID.konemestari]);
    const rng = bot(42);
    for (let i = 0; i < 60 * 60; i++) step(s, [botInput(s, s.heroes[0], rng)], DT);
    const h = s.heroes[0];
    return `${s.time.toFixed(3)}:${s.run.kills}:${s.floor}:${h.hp.toFixed(2)}`;
  };
  const a = run();
  const b = run();
  check('the same seed and bot input replay identically after 60s', a === b, a === b ? a : `${a} vs ${b}`);
}

function assertions(): void {
  checkDeterminism();
  checkArenas();
  checkEnemySpawnsNotSolid();
  checkFireDamagesEnemy();
  checkEnemyBulletsSlower();
  checkFloorCompletes();
  checkLiftGate();
  checkGunPickupSwap();
}

if (process.argv[2] !== 'quick') gunTable();
assertions();
if (fails) {
  console.log(`\n${fails} failed`);
  process.exitCode = 1;
}
