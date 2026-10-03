import { T, distanceField, flowDir, lineOfSight, openDir } from '../src/game/arena';
import { gunScore } from '../src/game/guns';
import type { CogDef } from '../src/game/content/cogs';
import type { Rng } from '../src/game/rng';
import { NO_INPUT, type Hero, type HeroInput, type SimState } from '../src/game/state';

/**
 * The bot: kites at the gun's range, sidesteps bullets coming at it, fires
 * at whatever is nearest, takes a gun when it scores better, and walks to
 * the lift. It is a floor for balance, not a player: no plan, no use of
 * bushes, no saving the super.
 */
const fields = new WeakMap<object, Map<number, Int16Array>>();

/** A direction toward (x, y) along walkable ground, fields cached per arena and goal tile. */
function walkTo(s: SimState, h: Hero, x: number, y: number): { dx: number; dy: number } {
  const a = s.arena;
  const key = Math.floor(y / T) * a.w + Math.floor(x / T);
  let m = fields.get(a);
  if (!m) {
    m = new Map();
    fields.set(a, m);
  }
  let f = m.get(key);
  if (!f) {
    f = distanceField(a, [{ x, y }]);
    m.set(key, f);
  }
  const d = Math.hypot(x - h.x, y - h.y) || 1;
  if (d < T) return { dx: (x - h.x) / d, dy: (y - h.y) / d };
  return flowDir(a, h.x, h.y, f) ?? { dx: (x - h.x) / d, dy: (y - h.y) / d };
}

export function botInput(s: SimState, h: Hero, rng: Rng): HeroInput {
  const inp: HeroInput = { ...NO_INPUT };
  if (!h.alive) return inp;
  const held = h.guns[h.active];
  const g = held.gun;
  let mx = 0;
  let my = 0;

  // Nearest enemy.
  let tgt = null as SimState['enemies'][number] | null;
  let td = Infinity;
  for (const e of s.enemies) {
    if (e.dead) continue;
    const d = Math.hypot(e.x - h.x, e.y - h.y);
    if (d < td) {
      td = d;
      tgt = e;
    }
  }

  // A better gun on the floor nearby: go and take it.
  let want: SimState['drops'][number] | null = null;
  let wd = s.phase === 'fight' ? 140 : 900;
  for (const d of s.drops) {
    if (d.kind !== 'gun' || !d.gun) continue;
    const dd = Math.hypot(d.x - h.x, d.y - h.y);
    const worst = h.guns.length < 2 ? 0 : Math.min(...h.guns.map((x) => gunScore(x.gun)));
    if (dd < wd && gunScore(d.gun) > worst * 1.08) {
      wd = dd;
      want = d;
    }
  }
  if (want && h.near === want.id) {
    // Replace the weaker gun: make it active first.
    if (h.guns.length === 2) {
      const weak = gunScore(h.guns[0].gun) <= gunScore(h.guns[1].gun) ? 0 : 1;
      if (h.active !== weak) inp.swap = true;
      else inp.take = true;
    } else inp.take = true;
  }

  const range = g.range * h.stats.rangeMul;
  if (tgt && s.phase === 'fight') {
    const pref = g.type === 'lance' || g.type === 'scatter' ? range * 0.55 : range * 0.7;
    const dx = (tgt.x - h.x) / td;
    const dy = (tgt.y - h.y) / td;
    const sees = lineOfSight(s.arena, h.x, h.y, tgt.x, tgt.y);
    if (!sees && td > 90) {
      const f = walkTo(s, h, tgt.x, tgt.y);
      mx = f.dx;
      my = f.dy;
    } else if (td > pref + 30) {
      mx = dx;
      my = dy;
    } else if (td < pref - 30) {
      mx = -dx;
      my = -dy;
    }
    // Circle a little, always.
    mx += -dy * 0.6;
    my += dx * 0.6;
    if (td < range * 1.1 && (sees || g.type === 'mortar')) inp.fire = true;
    if (h.superCharge >= 1 && td < 220) inp.superFire = true;
  } else if (want) {
    const f = walkTo(s, h, want.x, want.y);
    mx = f.dx;
    my = f.dy;
  } else if (s.phase === 'clear') {
    const f = walkTo(s, h, s.arena.liftX, s.arena.liftY);
    mx = f.dx;
    my = f.dy;
  }

  // Dodge: the most threatening enemy shot within reach, step across its line.
  for (const p of s.projectiles) {
    if (p.team !== 1) continue;
    if (p.lob) {
      const d = Math.hypot(p.lob.tx - h.x, p.lob.ty - h.y);
      if (d < p.blast + 14) {
        mx += (h.x - p.lob.tx) / (d || 1) * 2;
        my += (h.y - p.lob.ty) / (d || 1) * 2;
      }
      continue;
    }
    const rx = h.x - p.x;
    const ry = h.y - p.y;
    const d = Math.hypot(rx, ry);
    if (d > 140) continue;
    const sp = Math.hypot(p.vx, p.vy) || 1;
    const along = (rx * p.vx + ry * p.vy) / sp;
    if (along < 0) continue;
    const across = (rx * p.vy - ry * p.vx) / sp;
    if (Math.abs(across) > h.r + p.r + 10) continue;
    const side = across >= 0 ? 1 : -1;
    mx += (p.vy / sp) * side * 2.5;
    my += (-p.vx / sp) * side * 2.5;
  }

  // Do not walk into walls: try turning the wish.
  const m = Math.hypot(mx, my);
  if (m > 0.01) {
    const o = openDir(s.arena, h.x, h.y, h.r, mx / m, my / m);
    inp.mx = o.dx;
    inp.my = o.dy;
  }

  // Swap to the other gun when this one is dry and the other is not.
  if (!inp.swap && !inp.take && h.guns.length === 2 && held.ammo < 1 && h.guns[1 - h.active].ammo >= 2 && rng.chance(0.2)) inp.swap = true;
  return inp;
}

export function botPickCog(offers: CogDef[], rng: Rng): CogDef {
  return offers[Math.floor(rng.next() * offers.length)];
}
