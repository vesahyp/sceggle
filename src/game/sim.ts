import { t, tr } from '../i18n';
import { BUSH, T, flowDir, freeSpot, generateArena, lineOfSight, moveCircle, spawnTiles, tileAt, updateFlow } from './arena';
import { cogLevel, effect, explode, heal, hurtEnemy, hurtHero, killEnemy, nearestTarget, newId, text } from './combat';
import { AFFIXES, BOSSES, ENEMIES } from './content/enemies';
import type { HeroDef } from './content/heroes';
import { hold, rollGun, MAKER_INFO, RARITY_COLOR } from './guns';
import { createState, type Hero, type HeroInput, type SimState } from './state';
import type { Enemy, Held } from './types';
import { computeStats } from './upgrades';
import { fireBursts, maxAmmo, tickHeld, tryAttack, updateProjectiles, updateZones, type Shooter } from './weapons';

export const DT = 1 / 60;

/** Enemy toughness and bite by floor. Your guns grow 13% a floor (guns.levelMul); this grows faster, so loot is not optional. */
export function hpMul(floor: number): number {
  const f = floor - 1;
  return 1 + 0.2 * f + 0.012 * f * f;
}
export function dmgMul(floor: number): number {
  return 1 + 0.085 * (floor - 1);
}

export function newRun(seed: number, defs: HeroDef[]): SimState {
  const s = createState(seed, generateArena(seed, 1, false));
  for (let i = 0; i < defs.length; i++) {
    const d = defs[i];
    const h: Hero = {
      index: i,
      def: d,
      x: 0,
      y: 0,
      r: 12,
      hp: d.hp,
      alive: true,
      facing: -Math.PI / 2,
      moving: false,
      walk: 0,
      guns: [hold(rollGun(s.rng, 1, 1, d.start))],
      active: 0,
      superCharge: 0,
      dash: null,
      leap: null,
      shield: 0,
      cogs: {},
      stats: null as never,
      invuln: 0,
      hurtFlash: 0,
      sinceFire: 9,
      hidden: false,
      swapCd: 0,
      valveUsed: false,
      afterburn: 0,
      hits: 0,
      calm: 0,
      near: null,
      aimShow: { x: 0, y: 0, on: false, superOn: false, sx: 0, sy: 0 },
    };
    h.stats = computeStats(h);
    s.heroes.push(h);
  }
  startFloor(s, 1);
  return s;
}

export function startFloor(s: SimState, floor: number): void {
  s.floor = floor;
  s.run.floor = floor;
  s.bossFloor = floor % 5 === 0;
  s.arena = generateArena(s.seed, floor, s.bossFloor);
  s.enemies = [];
  s.projectiles = [];
  s.zones = [];
  s.drops = [];
  s.turrets = [];
  s.marks = [];
  s.effects = [];
  s.texts = [];
  s.phase = 'fight';
  s.floorTime = 0;
  s.liftT = 0;
  s.wavesLeft = s.bossFloor ? 1 : floor < 3 ? 2 : 3;
  s.waveBudget = 6 + floor * 3.2;
  s.waveTimer = -1.2;
  s.waveSize = 0;
  s.flowTimer = 0;
  s.heroes.forEach((h, i) => {
    h.x = s.arena.startX + (i - (s.heroes.length - 1) / 2) * 30;
    h.y = s.arena.startY;
    h.facing = -Math.PI / 2;
    h.valveUsed = false;
    h.dash = null;
    h.leap = null;
    if (!h.alive) {
      h.alive = true;
      h.hp = h.stats.maxHp * 0.5;
    }
    for (const g of h.guns) {
      g.ammo = maxAmmo(g, h);
      g.burstLeft = 0;
    }
  });
  s.cam.x = s.heroes[0].x;
  s.cam.y = s.heroes[0].y;
  updateFlow(s.arena, s.heroes);
  s.banner = s.bossFloor
    ? { text: tr(`Kerros ${floor}`, `Floor ${floor}`), sub: t(BOSSES[(floor / 5 - 1) % BOSSES.length].name), life: 2.6, color: '#ff7050' }
    : { text: tr(`Kerros ${floor}`, `Floor ${floor}`), sub: floorName(floor), life: 2 };
  s.sounds.push(s.bossFloor ? 'boss' : 'floor');
}

function floorName(floor: number): string {
  const names = [
    [tr('Kutomosali', 'The Weaving Hall'), tr('Kattilahuone', 'The Boiler Room'), tr('Valimo', 'The Foundry'), tr('Varasto', 'The Stores')],
    [tr('Koskivoimala', 'The Rapids Station'), tr('Turbiinisali', 'The Turbine Hall'), tr('Patoportti', 'The Dam Gate'), tr('Ratapiha', 'The Rail Yard')],
    [tr('Kellotorni', 'The Clock Tower'), tr('Ilmalaivasatama', 'The Airship Dock'), tr('Katot', 'The Rooftops'), tr('Savupiippu', 'The Chimney')],
    [tr('Konttori', 'The Counting House'), tr('Johtokunta', 'The Boardroom'), tr('Kassaholvi', 'The Vault'), tr('Huvila', 'The Villa')],
  ];
  const set = names[Math.floor((floor - 1) / 5) % names.length];
  return set[(floor - 1) % 5 % set.length];
}

/** Advance the run by one fixed step. */
export function step(s: SimState, inputs: HeroInput[], dt = DT): void {
  if (s.gameOver) {
    updateEffects(s, dt);
    return;
  }
  if (s.slowmo > 0) {
    s.slowmo -= dt;
    dt *= 0.35;
  }
  s.time += dt;
  s.floorTime += dt;
  s.shake = Math.max(0, s.shake - dt);
  if (s.banner) {
    s.banner.life -= dt;
    if (s.banner.life <= 0) s.banner = null;
  }

  for (const h of s.heroes) updateHero(s, h, inputs[h.index] ?? inputs[0], dt);
  const alive = s.heroes.filter((h) => h.alive);
  if (alive.length) {
    s.cam.x = alive.reduce((a, h) => a + h.x, 0) / alive.length;
    s.cam.y = alive.reduce((a, h) => a + h.y, 0) / alive.length;
  }

  s.flowTimer -= dt;
  if (s.flowTimer <= 0) {
    s.flowTimer = 0.25;
    updateFlow(s.arena, alive.length ? alive : s.heroes);
  }

  updateWaves(s, dt);
  updateMarks(s, dt);
  for (const e of s.enemies) updateEnemy(s, e, dt);
  separate(s);
  for (const tu of s.turrets) updateTurret(s, tu, dt);
  s.turrets = s.turrets.filter((x) => x.life > 0);
  updateProjectiles(s, dt);
  updateZones(s, dt);
  updateVents(s, dt);
  s.enemies = s.enemies.filter((e) => !e.dead);
  updateDrops(s, dt);
  updateEffects(s, dt);
  updateLift(s, dt);
}

// ————— heroes —————

function shooterOf(h: Hero): Shooter {
  return { x: h.x, y: h.y, team: 0, owner: h.index, dmgMul: 1, slow: 1, hero: h };
}

function updateHero(s: SimState, h: Hero, inp: HeroInput, dt: number): void {
  h.hurtFlash = Math.max(0, h.hurtFlash - dt);
  h.invuln = Math.max(0, h.invuln - dt);
  h.shield = Math.max(0, h.shield - dt);
  h.swapCd = Math.max(0, h.swapCd - dt);
  h.afterburn = Math.max(0, h.afterburn - dt);
  h.sinceFire += dt;
  if (!h.alive) return;

  // Supers in flight own the body.
  if (h.leap) {
    const L = h.leap;
    L.t += dt;
    const f = Math.min(1, L.t / L.dur);
    h.x = L.sx + (L.tx - L.sx) * f;
    h.y = L.sy + (L.ty - L.sy) * f;
    if (f >= 1) {
      h.leap = null;
      const p = freeSpot(s.arena, h.x, h.y, h.r);
      h.x = p.x;
      h.y = p.y;
      const dmg = 70 * (1 + 0.15 * (s.floor - 1));
      explode(s, h.x, h.y, 120, dmg, 0, h.index, 620, '#d8e8ff');
      effect(s, 'ring', h.x, h.y, 140, '#ffffff', 0.4);
      s.shake = 0.4;
      s.sounds.push('stomp');
    }
    return;
  }
  if (h.dash) {
    const D = h.dash;
    D.t -= dt;
    const before = { x: h.x, y: h.y };
    moveCircle(s.arena, h, h.r, D.dx * 820 * dt, D.dy * 820 * dt);
    effect(s, 'dash', before.x, before.y, 14, 'rgba(40,40,44,0.7)', 0.5, h.x, h.y);
    for (const e of s.enemies) {
      if (e.dead || D.hit.includes(e.id)) continue;
      if (Math.hypot(e.x - h.x, e.y - h.y) < e.r + h.r + 14) {
        D.hit.push(e.id);
        hurtEnemy(s, e, 55 * (1 + 0.15 * (s.floor - 1)), { owner: h.index, element: 'none', legend: null, x: h.x, y: h.y, kb: 300, proc: false });
      }
    }
    if (D.t <= 0) {
      h.dash = null;
      s.zones.push({ id: newId(s), kind: 'soot', team: 0, owner: h.index, x: h.x, y: h.y, r: 90, dps: 0, life: 4, maxLife: 4 });
    }
    return;
  }

  // Walk.
  const m = Math.hypot(inp.mx, inp.my);
  h.moving = m > 0.05;
  if (h.moving) {
    const k = Math.min(1, m);
    moveCircle(s.arena, h, h.r, (inp.mx / m) * k * h.stats.speed * dt, (inp.my / m) * k * h.stats.speed * dt);
    h.walk += dt * k * 10;
  }

  const held = h.guns[h.active];
  for (const g of h.guns) tickHeld(g, dt, h, g === held);
  const sh = shooterOf(h);
  fireBursts(s, sh, held, dt);

  // Aim and fire.
  const aimLen = Math.hypot(inp.aimX, inp.aimY);
  h.aimShow.on = inp.aiming && aimLen > 0.2;
  h.aimShow.x = inp.aimX;
  h.aimShow.y = inp.aimY;
  h.aimShow.superOn = inp.superAiming && Math.hypot(inp.superAimX, inp.superAimY) > 0.2;
  h.aimShow.sx = inp.superAimX;
  h.aimShow.sy = inp.superAimY;
  if (h.aimShow.on) h.facing = Math.atan2(inp.aimY, inp.aimX);
  else if (h.moving && h.sinceFire > 0.6) h.facing = Math.atan2(inp.my, inp.mx);
  if (inp.fire) {
    const g = held.gun;
    let angle = h.facing;
    let reach = 0.75;
    if (aimLen > 0.2) {
      angle = Math.atan2(inp.aimY, inp.aimX);
      reach = aimLen;
    } else {
      const range = g.range * h.stats.rangeMul;
      const tgt = nearestTarget(s, h.x, h.y, range * 1.15, g.type !== 'mortar');
      if (tgt) {
        angle = Math.atan2(tgt.y - h.y, tgt.x - h.x);
        reach = Math.hypot(tgt.x - h.x, tgt.y - h.y) / range;
      }
    }
    tryAttack(s, sh, held, angle, reach);
  }

  // Super.
  if (inp.superFire && h.superCharge >= 1) {
    const sl = Math.hypot(inp.superAimX, inp.superAimY);
    let angle = h.facing;
    let reach = 0.8;
    if (sl > 0.2) {
      angle = Math.atan2(inp.superAimY, inp.superAimX);
      reach = sl;
    } else {
      const tgt = nearestTarget(s, h.x, h.y, 320, h.def.super === 'leap');
      if (tgt) {
        angle = Math.atan2(tgt.y - h.y, tgt.x - h.x);
        reach = Math.min(1, Math.hypot(tgt.x - h.x, tgt.y - h.y) / 300);
      }
    }
    doSuper(s, h, angle, reach);
  }

  // Swap.
  if (inp.swap && h.guns.length > 1 && held.burstLeft <= 0) {
    h.active = 1 - h.active;
    const now = h.guns[h.active];
    now.lock = Math.max(now.lock, 0.15);
    if (cogLevel(h, 'vaihde') > 0 && h.swapCd <= 0) {
      now.ammo = maxAmmo(now, h);
      h.swapCd = 4;
    }
    s.sounds.push('swap');
  }

  // A gun on the floor under you: show it, take it on request.
  h.near = null;
  let nd = 30 * 30;
  for (const d of s.drops) {
    if (d.kind !== 'gun' || d.age < 0.3) continue;
    const dd = (d.x - h.x) ** 2 + (d.y - h.y) ** 2;
    if (dd < nd) {
      nd = dd;
      h.near = d.id;
    }
  }
  if (inp.take && h.near !== null) takeGun(s, h, h.near);

  // Hidden in the weeds until you fire.
  h.hidden = tileAt(s.arena, h.x, h.y) === BUSH && h.sinceFire > 1;

  // Brawl-style recovery: out of the fight for a while, health comes back.
  h.calm = h.hurtFlash > 0.15 ? 0 : h.calm + dt;
  if (h.sinceFire > 3 && h.calm > 3 && h.hp < h.stats.maxHp) h.hp = Math.min(h.stats.maxHp, h.hp + h.stats.maxHp * 0.07 * dt);
}

function doSuper(s: SimState, h: Hero, angle: number, reach: number): void {
  h.superCharge = 0;
  h.afterburn = 2 * cogLevel(h, 'jalkipolte');
  s.sounds.push('super');
  switch (h.def.super) {
    case 'dash':
      h.dash = { t: 0.24, dx: Math.cos(angle), dy: Math.sin(angle), hit: [] };
      h.invuln = 0.4;
      break;
    case 'leap': {
      const dist = 80 + 230 * reach;
      const tx = Math.max(T * 1.5, Math.min((s.arena.w - 1.5) * T, h.x + Math.cos(angle) * dist));
      const ty = Math.max(T * 1.5, Math.min((s.arena.h - 1.5) * T, h.y + Math.sin(angle) * dist));
      h.leap = { sx: h.x, sy: h.y, tx, ty, t: 0, dur: 0.6 };
      break;
    }
    case 'turret': {
      const x = h.x + Math.cos(angle) * 30;
      const y = h.y + Math.sin(angle) * 30;
      const g = h.guns[h.active].gun;
      s.turrets.push({ id: newId(s), owner: h.index, x, y, held: hold(g), life: 9, facing: angle });
      effect(s, 'ring', x, y, 40, '#e8c95a', 0.4);
      break;
    }
    case 'slam':
      explode(s, h.x, h.y, 130, 60 * (1 + 0.15 * (s.floor - 1)), 0, h.index, 700, '#ffd8a0');
      effect(s, 'ring', h.x, h.y, 160, '#ffe0b0', 0.5);
      h.shield = 3;
      s.shake = 0.45;
      break;
  }
}

function takeGun(s: SimState, h: Hero, dropId: number): void {
  const d = s.drops.find((x) => x.id === dropId);
  if (!d || !d.gun) return;
  const newHeld = hold(d.gun);
  newHeld.lock = 0.2;
  s.run.guns++;
  s.run.bestRarity = Math.max(s.run.bestRarity, d.gun.rarity);
  if (h.guns.length < 2) {
    h.guns.push(newHeld);
    h.active = h.guns.length - 1;
    s.drops = s.drops.filter((x) => x !== d);
  } else {
    const old = h.guns[h.active];
    h.guns[h.active] = newHeld;
    d.gun = old.gun;
    d.age = 0;
    d.vx = 0;
    d.vy = 0;
  }
  text(s, h.x, h.y - 26, t(newHeld.gun.name), RARITY_COLOR[newHeld.gun.rarity], true);
  s.sounds.push('take');
}

function updateTurret(s: SimState, tu: SimState['turrets'][number], dt: number): void {
  tu.life -= dt;
  const h = s.heroes[tu.owner];
  const sh: Shooter = { x: tu.x, y: tu.y, team: 0, owner: tu.owner, dmgMul: 0.8, slow: 1, hero: null };
  tickHeld(tu.held, dt, h, true);
  fireBursts(s, sh, tu.held, dt);
  const g = tu.held.gun;
  const tgt = nearestTarget(s, tu.x, tu.y, g.range, g.type !== 'mortar');
  if (tgt) {
    tu.facing = Math.atan2(tgt.y - tu.y, tgt.x - tu.x);
    tryAttack(s, sh, tu.held, tu.facing, Math.hypot(tgt.x - tu.x, tgt.y - tu.y) / g.range);
  }
}

// ————— waves —————

function updateWaves(s: SimState, dt: number): void {
  if (s.phase !== 'fight') return;
  s.waveTimer += dt;
  const alive = s.enemies.length + s.marks.length;
  if (s.wavesLeft > 0 && (s.waveTimer >= 0 && (alive <= Math.max(1, Math.floor(s.waveSize * 0.2)) || s.waveTimer > 24))) {
    spawnWave(s);
    s.wavesLeft--;
    s.waveTimer = 0;
  }
  if (s.wavesLeft === 0 && alive === 0) {
    s.phase = 'clear';
    s.liftT = 0;
    s.slowmo = Math.max(s.slowmo, 0.5);
    s.banner = { text: tr('Kerros puhdas', 'Floor clear'), sub: tr('Hissi on auki', 'The lift is open'), life: 2.2, color: '#9fe870' };
    s.sounds.push('clear');
    for (const d of s.drops) if (d.kind !== 'gun') d.pull = true;
  }
}

function spawnWave(s: SimState): void {
  const a = s.arena;
  const h0 = s.heroes.find((h) => h.alive) ?? s.heroes[0];
  const tiles = spawnTiles(a, h0.x, h0.y, 300);
  if (!tiles.length) return;
  const rng = s.rng;
  const spot = () => {
    const i = rng.pick(tiles);
    const tx = i % a.w;
    return { x: (tx + 0.5) * T, y: ((i - tx) / a.w + 0.5) * T };
  };
  let n = 0;
  if (s.bossFloor) {
    const bi = (s.floor / 5 - 1) % BOSSES.length;
    s.marks.push({ kind: 'boss', x: a.liftX, y: a.liftY + 5 * T, t: 1.6, elite: [], boss: bi });
    n++;
  }
  let budget = s.waveBudget * (s.bossFloor ? 0.4 : 1);
  const pool = Object.values(ENEMIES).filter((d) => d.floor <= s.floor);
  // A wave is two or three groups: each group is one kind from one spot, so
  // a wave has a shape to read (a rat swarm from the left, gunners behind).
  while (budget > 0.5) {
    const def = rng.weighted(pool, (d) => d.weight * (d.points <= budget + 1 ? 1 : 0.05));
    const groupSize = def.behaviour === 'swarm' ? rng.int(4, 7) : def.points >= 6 ? 1 : rng.int(1, 3);
    const at = spot();
    for (let k = 0; k < groupSize && budget > 0.5; k++) {
      const elite = s.floor >= 2 && def.behaviour !== 'swarm' && rng.chance(0.05 + s.floor * 0.008) ? rollAffixes(s) : [];
      s.marks.push({ kind: def.id, x: at.x + rng.range(-20, 20), y: at.y + rng.range(-20, 20), t: 1 + k * 0.08, elite, boss: -1 });
      budget -= def.points * (elite.length ? 3 : 1);
      n++;
    }
  }
  s.waveSize = n;
}

function rollAffixes(s: SimState): string[] {
  const keys = Object.keys(AFFIXES);
  const a = s.rng.pick(keys);
  if (s.floor >= 8 && s.rng.chance(0.4)) {
    const b = s.rng.pick(keys.filter((k) => k !== a));
    return [a, b];
  }
  return [a];
}

function updateMarks(s: SimState, dt: number): void {
  for (const m of s.marks) {
    m.t -= dt;
    if (m.t <= 0) spawnEnemy(s, m);
  }
  s.marks = s.marks.filter((m) => m.t > 0);
}

function spawnEnemy(s: SimState, m: SimState['marks'][number]): void {
  const hm = hpMul(s.floor);
  if (m.boss >= 0) {
    const b = BOSSES[m.boss];
    const cycle = Math.floor((s.floor - 1) / (5 * BOSSES.length));
    const hp = b.hp * hm * 0.55 * (1 + cycle * 0.5);
    const gun = rollGun(s.rng, s.floor, 2, { type: b.pattern === 'mortar' ? 'mortar' : 'revolver' });
    s.enemies.push(makeEnemy(s, 'boss', m.x, m.y, b.r, hp, b.speed, 'boss', b.touch * dmgMul(s.floor), hold(gun), [], true));
    s.banner = { text: t(b.name), sub: tr('saapuu', 'arrives'), life: 2.2, color: '#ff7050' };
    s.shake = 0.5;
    return;
  }
  const d = ENEMIES[m.kind];
  let hp = d.hp * hm;
  let speed = d.speed;
  let r = d.r;
  let touch = d.touch * dmgMul(s.floor);
  for (const a of m.elite) {
    const af = AFFIXES[a];
    hp *= af.hp;
    speed *= af.speed;
    r *= af.size;
    touch *= af.dmg;
  }
  if (m.elite.length) hp *= 2.6;
  const held = d.gun ? hold(rollGun(s.rng, s.floor, 0, d.gun)) : null;
  s.enemies.push(makeEnemy(s, d.id, m.x, m.y, r, hp, speed * s.rng.range(0.92, 1.08), d.behaviour, touch, held, m.elite, false));
  effect(s, 'puff', m.x, m.y, r * 2.5, 'rgba(220,220,220,0.7)', 0.5);
}

function makeEnemy(s: SimState, kind: string, x0: number, y0: number, r: number, hp: number, speed: number, behaviour: Enemy['behaviour'], touch: number, held: Held | null, elite: string[], boss: boolean): Enemy {
  const { x, y } = freeSpot(s.arena, x0, y0, r);
  return {
    id: newId(s),
    kind,
    x,
    y,
    vx: 0,
    vy: 0,
    r,
    hp,
    maxHp: hp,
    speed,
    behaviour,
    touch,
    held,
    elite,
    boss,
    mode: 'chase',
    modeT: s.rng.range(0.5, 1.5),
    cx: 0,
    cy: 0,
    seenX: x,
    seenY: y,
    lostFor: 0,
    aware: true,
    side: s.rng.chance(0.5) ? 1 : -1,
    burn: 0,
    burnDps: 0,
    slow: 0,
    blind: 0,
    stun: 0,
    flash: 0,
    kx: 0,
    ky: 0,
    facing: Math.PI / 2,
    age: 0,
    dead: false,
  };
}

// ————— enemies —————

function enemyShooter(s: SimState, e: Enemy): Shooter {
  const d = ENEMIES[e.kind];
  let mul = (d ? d.dmgMul : 0.4) * dmgMul(s.floor);
  for (const a of e.elite) mul *= AFFIXES[a].dmg;
  return { x: e.x, y: e.y, team: 1, owner: -1, dmgMul: mul, slow: 0.5, hero: null };
}

function targetHero(s: SimState, e: Enemy): Hero | null {
  let best: Hero | null = null;
  let bd = Infinity;
  for (const h of s.heroes) {
    if (!h.alive) continue;
    const d = Math.hypot(h.x - e.x, h.y - e.y);
    if (d < bd) {
      bd = d;
      best = h;
    }
  }
  return best;
}

function updateEnemy(s: SimState, e: Enemy, dt: number): void {
  e.age += dt;
  e.flash = Math.max(0, e.flash - dt);
  if (e.age < 0.35) return;
  if (e.burn > 0) {
    e.burn -= dt;
    e.hp -= e.burnDps * dt;
    s.run.damageDealt += e.burnDps * dt;
    if (Math.floor(e.burn * 3) !== Math.floor((e.burn + dt) * 3)) effect(s, 'spark', e.x + s.rng.range(-6, 6), e.y - e.r, 5, '#ff8a30', 0.3);
    if (e.hp <= 0) {
      killEnemy(s, e, 0);
      return;
    }
  }
  e.slow = Math.max(0, e.slow - dt);
  e.blind = Math.max(0, e.blind - dt);
  e.stun = Math.max(0, e.stun - dt);
  // Knockback moves the body first, then decays.
  if (e.kx || e.ky) {
    moveCircle(s.arena, e, e.r, e.kx * dt, e.ky * dt);
    const k = Math.pow(0.0015, dt);
    e.kx *= k;
    e.ky *= k;
    if (Math.abs(e.kx) + Math.abs(e.ky) < 5) e.kx = e.ky = 0;
  }
  const sh = e.held ? enemyShooter(s, e) : null;
  if (e.held && sh) {
    tickHeld(e.held, dt, null, true);
    fireBursts(s, sh, e.held, dt);
  }
  if (e.stun > 0) return;
  const h = targetHero(s, e);
  if (!h) return;
  const dx = h.x - e.x;
  const dy = h.y - e.y;
  const dist = Math.hypot(dx, dy) || 1;
  const sees = e.blind <= 0 && (!h.hidden || dist < 64) && dist < 520 && lineOfSight(s.arena, e.x, e.y, h.x, h.y);
  if (sees) {
    e.seenX = h.x;
    e.seenY = h.y;
    e.lostFor = 0;
  } else e.lostFor += dt;
  const speed = e.speed * (e.slow > 0 ? 0.5 : 1);
  e.modeT -= dt;

  // Walk toward (or away from) the hero: straight when in sight, else down the flow.
  const go = (sign: number, strafe = 0, mul = 1) => {
    let mx: number;
    let my: number;
    // Straight at the hero only when close and in sight; otherwise down
    // the walk field, which knows about pits and crates.
    const f = sign > 0 && !(sees && dist < 70) ? flowDir(s.arena, e.x, e.y) : null;
    if (f) {
      mx = f.dx;
      my = f.dy;
    } else {
      mx = (dx / dist) * sign;
      my = (dy / dist) * sign;
    }
    if (strafe) {
      mx += (-dy / dist) * strafe;
      my += (dx / dist) * strafe;
    }
    const m = Math.hypot(mx, my) || 1;
    moveCircle(s.arena, e, e.r, (mx / m) * speed * mul * dt, (my / m) * speed * mul * dt);
    e.facing = Math.atan2(my, mx);
  };

  switch (e.behaviour) {
    case 'swarm':
      go(1);
      contact(s, e, h, dist);
      break;
    case 'bomber':
      if (e.mode === 'fuse') {
        go(1, 0, 0.35);
        if (e.modeT <= 0) {
          e.dead = true;
          explode(s, e.x, e.y, 72, e.touch, 1, -1, 380, '#ff5020');
          s.run.kills++;
        }
      } else {
        go(1);
        if (dist < 46) {
          e.mode = 'fuse';
          e.modeT = 0.65;
          s.sounds.push('fuse');
        }
      }
      break;
    case 'brute':
      brute(s, e, h, dx, dy, dist, sees, go, dt);
      break;
    case 'gunner':
    case 'mortar':
    case 'turret': {
      const g = e.held!.gun;
      const pref = e.behaviour === 'mortar' ? g.range * 0.8 : g.range * 0.65;
      if (e.behaviour !== 'turret') {
        if (e.mode === 'windup') go(0.0001, 0, 0);
        else if (!sees) go(1);
        else if (dist > pref + 30) go(1, e.side * 0.4);
        else if (dist < pref - 50) go(-1, e.side * 0.6, 0.8);
        else go(0.0001, e.side, 0.6);
        if (s.rng.chance(dt * 0.4)) e.side = -e.side;
      }
      if (e.mode === 'windup') {
        e.facing = Math.atan2(dy, dx);
        if (e.modeT <= 0) {
          e.mode = 'chase';
          e.modeT = ENEMIES[e.kind].pause * s.rng.range(0.8, 1.3) * (e.elite.includes('raivo') ? 0.6 : 1);
          if (sh) tryAttack(s, sh, e.held!, Math.atan2(dy, dx), dist / g.range);
        }
      } else if (sees && e.modeT <= 0 && dist < g.range * (e.behaviour === 'mortar' ? 1 : 1.05) && e.held!.lock <= 0) {
        e.mode = 'windup';
        e.modeT = e.behaviour === 'mortar' ? 0.25 : 0.4;
      }
      break;
    }
    case 'boss':
      boss(s, e, h, dx, dy, dist, sees, go, sh!, dt);
      break;
  }
}

function contact(s: SimState, e: Enemy, h: Hero, dist: number): void {
  if (dist < e.r + h.r + 2 && e.modeT <= 0) {
    hurtHero(s, h, e.touch, e.x, e.y, 120);
    e.modeT = 0.7;
  }
}

function brute(s: SimState, e: Enemy, h: Hero, dx: number, dy: number, dist: number, sees: boolean, go: (sign: number, strafe?: number, mul?: number) => void, dt: number): void {
  switch (e.mode) {
    case 'windup':
      e.facing = Math.atan2(dy, dx);
      if (e.modeT <= 0) {
        e.mode = 'charge';
        e.modeT = 0.75;
        e.cx = dx / dist;
        e.cy = dy / dist;
        s.sounds.push('charge');
      }
      break;
    case 'charge': {
      const bx = e.x;
      const by = e.y;
      moveCircle(s.arena, e, e.r, e.cx * 400 * dt, e.cy * 400 * dt);
      if (Math.hypot(e.x - h.x, e.y - h.y) < e.r + h.r + 4) {
        hurtHero(s, h, e.touch * 1.4, e.x, e.y, 600);
        e.mode = 'recover';
        e.modeT = 0.9;
      } else if (Math.hypot(e.x - bx, e.y - by) < 2 || e.modeT <= 0) {
        // Hit a wall: dazed.
        e.mode = 'recover';
        e.modeT = Math.hypot(e.x - bx, e.y - by) < 2 ? 1.4 : 0.7;
        if (e.modeT > 1) {
          effect(s, 'ring', e.x, e.y, 40, '#ffffff', 0.3);
          s.shake = Math.max(s.shake, 0.2);
        }
      }
      break;
    }
    case 'recover':
      if (e.modeT <= 0) {
        e.mode = 'chase';
        e.modeT = 1.2;
      }
      break;
    default:
      go(1);
      contact(s, e, h, dist);
      if (sees && dist < 220 && e.modeT <= 0) {
        e.mode = 'windup';
        e.modeT = 0.7;
      }
  }
}

/** A slow, big enemy bullet, for boss patterns. */
function orb(s: SimState, e: Enemy, angle: number, speed: number, dmg: number, r = 9): void {
  s.projectiles.push({
    id: newId(s),
    team: 1,
    owner: -1,
    x: e.x + Math.cos(angle) * e.r,
    y: e.y + Math.sin(angle) * e.r,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    r,
    damage: dmg,
    life: 700,
    pierce: 0,
    bounces: 0,
    blast: 0,
    element: 'none',
    homing: 0,
    hit: [],
    gunType: 'revolver',
    maker: 'paukku',
    rarity: 0,
    legend: null,
    lob: null,
    spin: 0,
    split: false,
    dead: false,
  });
}

function lobAt(s: SimState, e: Enemy, tx: number, ty: number, dmg: number, blast: number, dur: number): void {
  s.projectiles.push({
    id: newId(s),
    team: 1,
    owner: -1,
    x: e.x,
    y: e.y,
    vx: 0,
    vy: 0,
    r: 9,
    damage: dmg,
    life: 0,
    pierce: 0,
    bounces: 0,
    blast,
    element: 'none',
    homing: 0,
    hit: [],
    gunType: 'mortar',
    maker: 'torpeedo',
    rarity: 0,
    legend: null,
    lob: { sx: e.x, sy: e.y, tx, ty, t: 0, dur },
    spin: 0,
    split: false,
    dead: false,
  });
}

function boss(s: SimState, e: Enemy, h: Hero, dx: number, dy: number, dist: number, sees: boolean, go: (sign: number, strafe?: number, mul?: number) => void, sh: Shooter, dt: number): void {
  const b = BOSSES[(s.floor / 5 - 1) % BOSSES.length] ?? BOSSES[0];
  const dm = dmgMul(s.floor);
  const angry = e.hp < e.maxHp * 0.5;
  const ex = e as Enemy & { pt?: number; pt2?: number; spin?: number };
  ex.pt = (ex.pt ?? 2) - dt * (angry ? 1.35 : 1);
  ex.pt2 = (ex.pt2 ?? 5) - dt;
  ex.spin = (ex.spin ?? 0) + dt;
  const toward = Math.atan2(dy, dx);
  void sh;
  switch (b.pattern) {
    case 'king':
      if (e.mode === 'windup' || e.mode === 'charge' || e.mode === 'recover') {
        brute(s, e, h, dx, dy, dist, sees, go, dt);
        break;
      }
      go(1);
      contact(s, e, h, dist);
      if (ex.pt <= 0) {
        ex.pt = 2.6;
        const n = angry ? 20 : 14;
        for (let i = 0; i < n; i++) orb(s, e, (i / n) * Math.PI * 2 + ex.spin, 150, 12 * dm, 10);
        s.sounds.push('bossshot');
      }
      if (ex.pt2 <= 0 && sees) {
        ex.pt2 = 4.5;
        e.mode = 'windup';
        e.modeT = 0.8;
      }
      break;
    case 'mortar':
      if (dist < 200) go(-1, 0.5, 0.8);
      else if (dist > 320) go(1);
      else go(0.0001, e.side, 0.5);
      contact(s, e, h, dist);
      if (ex.pt <= 0) {
        ex.pt = 1.4;
        lobAt(s, e, h.x, h.y, 22 * dm, 60, 1.1);
        s.sounds.push('bossshot');
      }
      if (ex.pt2 <= 0) {
        ex.pt2 = 6;
        for (let i = 0; i < (angry ? 9 : 6); i++) {
          const a = s.rng.range(0, Math.PI * 2);
          const r = s.rng.range(40, 170);
          lobAt(s, e, h.x + Math.cos(a) * r, h.y + Math.sin(a) * r, 18 * dm, 55, 1.2 + i * 0.12);
        }
        for (let i = 0; i < 3; i++) s.marks.push({ kind: 'rotta', x: e.x + s.rng.range(-40, 40), y: e.y + s.rng.range(-40, 40), t: 0.6, elite: [], boss: -1 });
      }
      break;
    case 'clock': {
      // Drifts to the middle, then turns the hands.
      const cx = (s.arena.w / 2) * T;
      const cy = (s.arena.h / 2) * T - 2 * T;
      const md = Math.hypot(cx - e.x, cy - e.y);
      if (md > 10) moveCircle(s.arena, e, e.r, ((cx - e.x) / md) * e.speed * dt, ((cy - e.y) / md) * e.speed * dt);
      contact(s, e, h, dist);
      if (ex.pt <= 0) {
        ex.pt = angry ? 0.16 : 0.22;
        const arms = angry ? 4 : 3;
        for (let i = 0; i < arms; i++) orb(s, e, ex.spin * 0.9 + (i / arms) * Math.PI * 2, 135, 11 * dm, 8);
      }
      if (ex.pt2 <= 0) {
        ex.pt2 = 4;
        for (let i = -2; i <= 2; i++) orb(s, e, toward + i * 0.16, 210, 14 * dm, 9);
        s.sounds.push('bossshot');
      }
      break;
    }
    case 'owner':
      if (e.mode === 'windup' || e.mode === 'charge' || e.mode === 'recover') {
        brute(s, e, h, dx, dy, dist, sees, go, dt);
        break;
      }
      go(dist > 160 ? 1 : 0.0001, e.side, 0.8);
      contact(s, e, h, dist);
      if (ex.pt <= 0 && sees) {
        ex.pt = 1.3;
        for (let i = -3; i <= 3; i++) orb(s, e, toward + i * 0.13, 190, 12 * dm, 8);
        s.sounds.push('bossshot');
      }
      if (ex.pt2 <= 0) {
        ex.pt2 = 7;
        if (s.rng.chance(0.5) && sees) {
          e.mode = 'windup';
          e.modeT = 0.7;
        } else for (let i = 0; i < 2; i++) s.marks.push({ kind: 'niittari', x: e.x + s.rng.range(-60, 60), y: e.y + s.rng.range(-60, 60), t: 0.8, elite: [], boss: -1 });
      }
      break;
  }
}

/** Bodies push each other apart so a crowd has a shape. */
function separate(s: SimState): void {
  const es = s.enemies;
  for (let i = 0; i < es.length; i++) {
    const a = es[i];
    for (let j = i + 1; j < es.length; j++) {
      const b = es[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const rr = a.r + b.r;
      const d2 = dx * dx + dy * dy;
      if (d2 >= rr * rr || d2 < 0.01) continue;
      const d = Math.sqrt(d2);
      const push = (rr - d) * 0.5;
      const nx = dx / d;
      const ny = dy / d;
      // Share of the push each body takes: bosses and towers do not budge.
      const fixedA = a.boss || a.behaviour === 'turret';
      const fixedB = b.boss || b.behaviour === 'turret';
      if (fixedA && fixedB) continue;
      const wa = fixedA ? 0 : fixedB ? 1 : 0.5;
      const wb = 1 - wa;
      if (wa) moveCircle(s.arena, a, a.r, -nx * push * 2 * wa, -ny * push * 2 * wa);
      if (wb) moveCircle(s.arena, b, b.r, nx * push * 2 * wb, ny * push * 2 * wb);
    }
  }
}

function updateVents(s: SimState, dt: number): void {
  const a = s.arena;
  for (const v of a.vents) {
    v.t -= dt;
    if (v.t > 0) continue;
    v.t = 4;
    const x = ((v.i % a.w) + 0.5) * T;
    const y = (Math.floor(v.i / a.w) + 0.5) * T;
    s.zones.push({ id: newId(s), kind: 'steam', team: 1, owner: -1, x, y, r: 44, dps: 18 * dmgMul(s.floor), life: 1.3, maxLife: 1.3 });
    // A vent scalds the works too.
    for (const e of s.enemies) if (Math.hypot(e.x - x, e.y - y) < 44) hurtEnemy(s, e, 15 * dmgMul(s.floor), { owner: -1, element: 'none', legend: null, x, y, kb: 0, proc: false });
    s.sounds.push('vent');
  }
}

// ————— drops, lift, effects —————

function updateDrops(s: SimState, dt: number): void {
  for (const d of s.drops) {
    d.age += dt;
    if (d.vx || d.vy) moveCircle(s.arena, d, 6, d.vx * dt, d.vy * dt);
    d.vx *= Math.pow(0.02, dt);
    d.vy *= Math.pow(0.02, dt);
    if (d.kind === 'gun') continue;
    // Nearest living hero.
    let h: Hero | null = null;
    let hd = Infinity;
    for (const x of s.heroes) {
      if (!x.alive) continue;
      const dd = Math.hypot(x.x - d.x, x.y - d.y);
      if (dd < hd) {
        hd = dd;
        h = x;
      }
    }
    if (!h) continue;
    if (d.age > 0.4 && (d.pull || hd < h.stats.magnet)) {
      // Pulled drops fly over everything.
      const sp = d.pull ? 520 : 300;
      d.x += ((h.x - d.x) / hd) * sp * dt;
      d.y += ((h.y - d.y) / hd) * sp * dt;
    }
    if (hd < h.r + 8 && d.age > 0.25) {
      d.age = -999;
      if (d.kind === 'coin') {
        s.run.coins += d.value;
        s.sounds.push('coin');
      } else {
        heal(s, h, d.value);
        s.sounds.push('steam');
      }
    }
  }
  s.drops = s.drops.filter((d) => d.age > -1);
}

function updateEffects(s: SimState, dt: number): void {
  for (const e of s.effects) e.life -= dt;
  s.effects = s.effects.filter((e) => e.life > 0);
  for (const x of s.texts) {
    x.life -= dt;
    x.y -= dt * 30;
  }
  s.texts = s.texts.filter((x) => x.life > 0);
}

function updateLift(s: SimState, dt: number): void {
  if (s.phase !== 'clear') return;
  const a = s.arena;
  const alive = s.heroes.filter((h) => h.alive);
  const on = alive.length > 0 && alive.every((h) => Math.hypot(h.x - a.liftX, h.y - a.liftY) < 40);
  s.liftT = on ? s.liftT + dt : Math.max(0, s.liftT - dt * 2);
  if (s.liftT >= 0.8) {
    s.phase = 'done';
    s.pendingCogs = s.bossFloor ? 2 : 1;
    s.sounds.push('lift');
  }
}

/** Called by the UI once the cogs are picked. */
export function nextFloor(s: SimState): void {
  for (const h of s.heroes) heal(s, h, h.stats.maxHp * 0.25);
  startFloor(s, s.floor + 1);
}

export function makerName(m: keyof typeof MAKER_INFO): string {
  return MAKER_INFO[m].name;
}
