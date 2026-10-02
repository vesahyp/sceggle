import { t } from '../i18n';
import { BARREL, CRATE, FLOOR, T, lineOfSight } from './arena';
import { rollGun, rollRarity, RARITY_COLOR } from './guns';
import { ENEMIES } from './content/enemies';
import type { Hero, SimState } from './state';
import type { Element, Enemy, Team } from './types';

/**
 * Every hit goes through here: hurtEnemy for the works, hurtHero for the
 * heroes, explode for anything with a radius. Damage numbers, knockback,
 * statuses, kills, drops and run stats all live in these functions, so a
 * new gun or cog never has to remember them.
 */

export interface HitSource {
  owner: number;
  element: Element;
  legend: string | null;
  x: number;
  y: number;
  /** knockback speed */
  kb: number;
  /** a status hit (burn tick, chain) does not proc other on-hit rules */
  proc: boolean;
}

export function cogLevel(h: Hero | undefined, id: string): number {
  return h ? (h.cogs[id] ?? 0) : 0;
}

export function newId(s: SimState): number {
  return s.nextId++;
}

export function text(s: SimState, x: number, y: number, txt: string, color: string, big = false): void {
  if (s.texts.length >= 60) s.texts.shift();
  s.texts.push({ x: x + s.rng.range(-6, 6), y: y - 10, text: txt, color, life: big ? 1.1 : 0.7, big });
}

export function effect(s: SimState, kind: SimState['effects'][number]['kind'], x: number, y: number, r: number, color: string, life: number, x2 = x, y2 = y): void {
  if (s.effects.length >= 220) s.effects.shift();
  s.effects.push({ kind, x, y, x2, y2, r, color, life, maxLife: life });
}

export function hurtEnemy(s: SimState, e: Enemy, dmg: number, src: HitSource): void {
  if (e.dead || dmg <= 0) return;
  const h = src.owner >= 0 ? s.heroes[src.owner] : undefined;
  e.hp -= dmg;
  e.flash = 0.1;
  e.aware = true;
  if (h) {
    e.seenX = h.x;
    e.seenY = h.y;
    e.lostFor = 0;
  }
  s.run.damageDealt += dmg;
  const crit = dmg >= 60;
  text(s, e.x, e.y - e.r, String(Math.round(dmg)), crit ? '#ffd040' : '#ffffff', crit);
  if (src.kb > 0 && !e.boss) {
    const dx = e.x - src.x;
    const dy = e.y - src.y;
    const d = Math.hypot(dx, dy) || 1;
    const resist = e.behaviour === 'brute' || e.behaviour === 'turret' ? 0.25 : 1;
    e.kx += (dx / d) * src.kb * resist;
    e.ky += (dy / d) * src.kb * resist;
  }
  if (h) {
    // The super fills from damage dealt, by the hero's rate.
    h.superCharge = Math.min(1, h.superCharge + (dmg / 520) * h.stats.superRate);
    if (src.legend === 'kahvipannu') heal(s, h, dmg * 0.22);
  }
  // Statuses: the gun's element and the cogs.
  const fire = src.element === 'fire' || (src.proc && cogLevel(h, 'tuli') > 0);
  if (fire) {
    const lvl = Math.max(1, cogLevel(h, 'tuli'));
    e.burn = 3;
    e.burnDps = Math.max(e.burnDps, dmg * (src.element === 'fire' ? 0.35 : 0) + dmg * 0.25 * cogLevel(h, 'tuli') + 2 * lvl);
  }
  if (src.element === 'frost' || (src.proc && cogLevel(h, 'pakkanen') > 0)) e.slow = Math.max(e.slow, 1.6 + 0.6 * cogLevel(h, 'pakkanen'));
  if (src.proc && h) {
    h.hits++;
    const tesla = cogLevel(h, 'tesla');
    const shock = src.element === 'shock';
    const jumps = src.legend === 'voimala' ? 3 : shock ? 2 : tesla > 0 && h.hits % 4 === 0 ? tesla + 1 : 0;
    if (jumps > 0) chain(s, e, dmg * (shock ? 0.6 : 0.5), jumps, src.owner);
  }
  s.sounds.push('hit');
  if (e.hp <= 0) killEnemy(s, e, src.owner);
}

function chain(s: SimState, from: Enemy, dmg: number, jumps: number, owner: number): void {
  const hitIds = new Set<number>([from.id]);
  let cur = from;
  for (let j = 0; j < jumps; j++) {
    let best: Enemy | null = null;
    let bd = 130 * 130;
    for (const e of s.enemies) {
      if (e.dead || hitIds.has(e.id)) continue;
      const d = (e.x - cur.x) ** 2 + (e.y - cur.y) ** 2;
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    if (!best) break;
    hitIds.add(best.id);
    effect(s, 'chain', cur.x, cur.y, 0, '#9fe8ff', 0.18, best.x, best.y);
    const next: Enemy = best;
    hurtEnemy(s, next, dmg, { owner, element: 'none', legend: null, x: cur.x, y: cur.y, kb: 0, proc: false });
    cur = next;
  }
  s.sounds.push('zap');
}

export function heal(s: SimState, h: Hero, amount: number): void {
  if (!h.alive || amount <= 0) return;
  const before = h.hp;
  h.hp = Math.min(h.stats.maxHp, h.hp + amount);
  if (h.hp - before >= 4) text(s, h.x, h.y - 18, `+${Math.round(h.hp - before)}`, '#7dff9a');
}

export function hurtHero(s: SimState, h: Hero, dmg: number, x: number, y: number, kb = 0): void {
  if (!h.alive || h.invuln > 0 || h.leap || h.dash) return;
  let d = dmg * (1 - h.stats.armor);
  if (h.shield > 0) d *= 0.3;
  h.hp -= d;
  h.hurtFlash = 0.2;
  h.invuln = 0.12;
  s.shake = Math.max(s.shake, 0.18);
  text(s, h.x, h.y - 16, String(Math.round(d)), '#ff5a4a');
  s.sounds.push('hurt');
  if (kb > 0) {
    const dx = h.x - x;
    const dy = h.y - y;
    const dd = Math.hypot(dx, dy) || 1;
    h.x += (dx / dd) * kb * 0.06;
    h.y += (dy / dd) * kb * 0.06;
  }
  // The relief valve: once a floor, under a third of health, a blast.
  if (cogLevel(h, 'vaali') > 0 && !h.valveUsed && h.hp > 0 && h.hp < h.stats.maxHp / 3) {
    h.valveUsed = true;
    explode(s, h.x, h.y, 120 + 30 * cogLevel(h, 'vaali'), 30 * cogLevel(h, 'vaali'), 0, h.index, 520, '#e8f0ff');
    h.invuln = 1;
  }
  if (h.hp <= 0) {
    h.hp = 0;
    h.alive = false;
    s.sounds.push('death');
    s.shake = 0.6;
    effect(s, 'blast', h.x, h.y, 60, '#ff6a3a', 0.6);
    if (s.heroes.every((o) => !o.alive)) s.gameOver = true;
  }
}

/**
 * A blast: hurts the other team in the radius, breaks crates, sets off
 * barrels. Team -1 (a barrel) hurts everyone.
 */
export function explode(s: SimState, x: number, y: number, r: number, dmg: number, team: Team | -1, owner: number, kb = 260, color = '#ffb040'): void {
  effect(s, 'blast', x, y, r, color, 0.4);
  s.shake = Math.max(s.shake, Math.min(0.35, r / 300));
  s.sounds.push('boom');
  if (team !== 0) {
    for (const h of s.heroes) {
      if (!h.alive) continue;
      const d = Math.hypot(h.x - x, h.y - y);
      if (d < r + h.r) hurtHero(s, h, dmg * (team === -1 ? 0.5 : 1) * (d < r * 0.5 ? 1 : 0.7), x, y, kb);
    }
  }
  if (team !== 1) {
    for (const e of s.enemies) {
      if (e.dead) continue;
      const d = Math.hypot(e.x - x, e.y - y);
      if (d < r + e.r) hurtEnemy(s, e, dmg * (d < r * 0.5 ? 1 : 0.7), { owner, element: 'none', legend: null, x, y, kb, proc: false });
    }
  }
  // Tiles in the radius.
  const a = s.arena;
  const x0 = Math.max(0, Math.floor((x - r) / T));
  const x1 = Math.min(a.w - 1, Math.floor((x + r) / T));
  const y0 = Math.max(0, Math.floor((y - r) / T));
  const y1 = Math.min(a.h - 1, Math.floor((y + r) / T));
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const i = ty * a.w + tx;
      const tt = a.tiles[i];
      if (tt !== CRATE && tt !== BARREL) continue;
      if (Math.hypot((tx + 0.5) * T - x, (ty + 0.5) * T - y) > r + T * 0.5) continue;
      damageTile(s, i, dmg * 0.8, owner);
    }
  }
}

export function damageTile(s: SimState, i: number, dmg: number, owner: number): void {
  const a = s.arena;
  const tt = a.tiles[i];
  if (tt !== CRATE && tt !== BARREL) return;
  a.hp[i] -= dmg;
  if (a.hp[i] > 0) return;
  const x = ((i % a.w) + 0.5) * T;
  const y = (Math.floor(i / a.w) + 0.5) * T;
  a.tiles[i] = FLOOR;
  if (tt === CRATE) {
    effect(s, 'debris', x, y, 20, '#a07040', 0.5);
    s.sounds.push('crate');
    // Crates sometimes hold coins or steam.
    if (s.rng.chance(0.3)) dropAt(s, x, y, s.rng.chance(0.5) ? 'coin' : 'steam', s.rng.int(2, 5));
  } else {
    // A barrel: set off a little later, so chains ripple.
    a.hp[i] = 0;
    explode(s, x, y, 78, 38 + s.floor * 3, -1, owner, 320, '#ff6a20');
    effect(s, 'ring', x, y, 90, '#ffcf60', 0.3);
  }
  s.flowTimer = 0;
}

export function dropAt(s: SimState, x: number, y: number, kind: 'coin' | 'steam', value: number): void {
  const ang = s.rng.range(0, Math.PI * 2);
  const sp = s.rng.range(40, 110);
  s.drops.push({ id: newId(s), kind, x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, value, gun: null, age: 0, pull: s.phase !== 'fight' });
}

export function dropGun(s: SimState, x: number, y: number, rarity: number, opts: Parameters<typeof rollGun>[3] = {}): void {
  const g = rollGun(s.rng, s.floor, rarity, opts);
  const ang = s.rng.range(0, Math.PI * 2);
  s.drops.push({ id: newId(s), kind: 'gun', x, y, vx: Math.cos(ang) * 60, vy: Math.sin(ang) * 60, value: 0, gun: g, age: 0, pull: false });
  if (rarity >= 3) {
    s.sounds.push(rarity >= 4 ? 'legend' : 'epic');
    effect(s, 'ring', x, y, 70, RARITY_COLOR[rarity], 0.8);
  }
}

export function killEnemy(s: SimState, e: Enemy, owner: number): void {
  if (e.dead) return;
  e.dead = true;
  s.run.kills++;
  s.sounds.push(e.boss ? 'bosskill' : 'kill');
  effect(s, 'debris', e.x, e.y, e.r * 1.6, '#c8a060', 0.5);
  effect(s, 'puff', e.x, e.y, e.r * 2, 'rgba(230,230,230,0.6)', 0.5);
  const h = owner >= 0 ? s.heroes[owner] : undefined;
  const luck = s.heroes.reduce((m, x) => Math.max(m, x.stats.luck), 0);
  const coinMul = s.heroes.reduce((m, x) => Math.max(m, x.stats.coinMul), 1);
  // Coins every time, steam sometimes, guns from the ones that carried one.
  const coins = Math.max(1, Math.round((e.boss ? 40 : e.elite.length ? 8 : ENEMIES[e.kind]?.points ?? 1) * coinMul));
  for (let i = 0; i < Math.min(coins, 8); i++) dropAt(s, e.x, e.y, 'coin', Math.ceil(coins / Math.min(coins, 8)));
  if (s.rng.chance(e.boss ? 1 : e.elite.length ? 0.6 : 0.06)) dropAt(s, e.x, e.y, 'steam', e.boss ? 40 : 14);
  if (e.boss) {
    s.run.bosses++;
    dropGun(s, e.x, e.y, rollRarity(s.rng, s.floor, luck, 3));
    dropGun(s, e.x + 20, e.y, rollRarity(s.rng, s.floor, luck, 2));
    s.slowmo = 1.2;
    s.shake = 0.7;
  } else if (e.elite.length) {
    dropGun(s, e.x, e.y, rollRarity(s.rng, s.floor, luck, 1));
  } else if (e.held && s.rng.chance(ENEMIES[e.kind]?.dropGun ?? 0)) {
    // What shot at you is what you take: the same type and maker.
    dropGun(s, e.x, e.y, rollRarity(s.rng, s.floor, luck), { type: e.held.gun.type, maker: e.held.gun.maker });
  }
  if (e.elite.includes('rajahtava')) explode(s, e.x, e.y, 70, 25 + s.floor * 2, 1, -1, 300, '#ff5030');
  if (h) {
    const corpse = cogLevel(h, 'ruumis');
    if (corpse > 0) explode(s, e.x, e.y, 30 + 15 * corpse, 10 + 8 * corpse + s.floor * 1.5, 0, h.index, 150, '#ffd080');
    const siphon = cogLevel(h, 'imu');
    if (siphon > 0) heal(s, h, siphon * 2);
  }
}

/** The nearest enemy this point can shoot at, within range. */
export function nearestTarget(s: SimState, x: number, y: number, range: number, needSight = true): Enemy | null {
  let best: Enemy | null = null;
  let bd = range * range;
  for (const e of s.enemies) {
    if (e.dead || e.age < 0.4) continue;
    const d = (e.x - x) ** 2 + (e.y - y) ** 2;
    if (d >= bd) continue;
    if (needSight && !lineOfSight(s.arena, x, y, e.x, e.y)) continue;
    bd = d;
    best = e;
  }
  return best;
}

export function enemyName(e: Enemy, bossName?: string): string {
  if (bossName) return bossName;
  const base = ENEMIES[e.kind] ? t(ENEMIES[e.kind].name) : e.kind;
  return base;
}
