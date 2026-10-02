import { Rng } from './rng';

/**
 * The arena: one floor of the works, a grid of tiles generated from the run
 * seed and the floor number. Mirrored left to right, the way Brawl Stars
 * maps are, so it reads as a place someone built and a fight is fair from
 * either side.
 */
export const T = 32;

export const FLOOR = 0;
export const WALL = 1;
export const CRATE = 2;
export const BUSH = 3;
export const BARREL = 4;
/** the race of the rapids under the works: blocks walking, not shots */
export const PIT = 5;
/** a steam vent in the floor: walkable, puffs scalding steam on a timer */
export const VENT = 6;

export const CRATE_HP = 40;
export const BARREL_HP = 12;

export interface Arena {
  w: number;
  h: number;
  tiles: Uint8Array;
  /** hit points of crates and barrels, by tile index */
  hp: Float32Array;
  /** where the hero comes in and where the lift is */
  startX: number;
  startY: number;
  liftX: number;
  liftY: number;
  /** BFS distance in tiles from the nearest living hero, -1 unreachable */
  flow: Int16Array;
  /** per-vent timers */
  vents: { i: number; t: number }[];
  /** 0..3: which palette the floor uses */
  style: number;
}

export function solidMove(t: number): boolean {
  return t === WALL || t === CRATE || t === BARREL || t === PIT;
}

export function solidShot(t: number): boolean {
  return t === WALL || t === CRATE || t === BARREL;
}

export function tileAt(a: Arena, x: number, y: number): number {
  const tx = Math.floor(x / T);
  const ty = Math.floor(y / T);
  if (tx < 0 || ty < 0 || tx >= a.w || ty >= a.h) return WALL;
  return a.tiles[ty * a.w + tx];
}

export function idxAt(a: Arena, x: number, y: number): number {
  const tx = Math.floor(x / T);
  const ty = Math.floor(y / T);
  if (tx < 0 || ty < 0 || tx >= a.w || ty >= a.h) return -1;
  return ty * a.w + tx;
}

/** Move a circle by (dx, dy), stopping at solid tiles, one axis at a time. */
export function moveCircle(a: Arena, p: { x: number; y: number }, r: number, dx: number, dy: number, ghost = false): void {
  const step = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / (r * 0.8)));
  const sx = dx / step;
  const sy = dy / step;
  for (let i = 0; i < step; i++) {
    p.x += sx;
    if (!ghost && hitsSolid(a, p.x, p.y, r)) {
      p.x -= sx;
    }
    p.y += sy;
    if (!ghost && hitsSolid(a, p.x, p.y, r)) {
      p.y -= sy;
    }
  }
  // Never leave the arena, even a ghost.
  p.x = Math.max(T + r, Math.min((a.w - 1) * T - r, p.x));
  p.y = Math.max(T + r, Math.min((a.h - 1) * T - r, p.y));
}

export function hitsSolid(a: Arena, x: number, y: number, r: number): boolean {
  const x0 = Math.floor((x - r) / T);
  const x1 = Math.floor((x + r) / T);
  const y0 = Math.floor((y - r) / T);
  const y1 = Math.floor((y + r) / T);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (tx < 0 || ty < 0 || tx >= a.w || ty >= a.h) return true;
      if (!solidMove(a.tiles[ty * a.w + tx])) continue;
      // circle vs box
      const cx = Math.max(tx * T, Math.min(x, tx * T + T));
      const cy = Math.max(ty * T, Math.min(y, ty * T + T));
      if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) return true;
    }
  }
  return false;
}

/** The nearest point to (x, y) where a circle of radius r stands free. */
export function freeSpot(a: Arena, x: number, y: number, r: number): { x: number; y: number } {
  if (!hitsSolid(a, x, y, r)) return { x, y };
  for (let d = 8; d < 200; d += 8) {
    for (let k = 0; k < 12; k++) {
      const px = x + Math.cos((k / 12) * Math.PI * 2) * d;
      const py = y + Math.sin((k / 12) * Math.PI * 2) * d;
      if (!hitsSolid(a, px, py, r)) return { x: px, y: py };
    }
  }
  return { x, y };
}

/** True when nothing that stops a bullet lies on the segment. */
export function lineOfSight(a: Arena, x0: number, y0: number, x1: number, y1: number): boolean {
  const d = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.ceil(d / 10);
  for (let i = 1; i < n; i++) {
    const f = i / n;
    if (solidShot(tileAt(a, x0 + (x1 - x0) * f, y0 + (y1 - y0) * f))) return false;
  }
  return true;
}

/** Multi-source BFS over walkable tiles from the given points, into the arena's flow. */
export function updateFlow(a: Arena, from: { x: number; y: number }[]): void {
  distanceField(a, from, a.flow);
}

/** BFS distance in tiles from the given points; -1 where no walk reaches. */
export function distanceField(a: Arena, from: { x: number; y: number }[], f: Int16Array = new Int16Array(a.w * a.h)): Int16Array {
  f.fill(-1);
  const q = new Int32Array(a.w * a.h);
  let qh = 0;
  let qt = 0;
  for (const p of from) {
    const i = idxAt(a, p.x, p.y);
    if (i < 0 || f[i] === 0) continue;
    f[i] = 0;
    q[qt++] = i;
  }
  while (qh < qt) {
    const i = q[qh++];
    const x = i % a.w;
    const y = (i - x) / a.w;
    const d = f[i] + 1;
    const ns = [x > 0 ? i - 1 : -1, x < a.w - 1 ? i + 1 : -1, y > 0 ? i - a.w : -1, y < a.h - 1 ? i + a.w : -1];
    for (const j of ns) {
      if (j < 0 || f[j] !== -1) continue;
      // Only what a body can walk: the map is built so a way round
      // every crate exists, and a field through crates strands walkers.
      if (solidMove(a.tiles[j])) continue;
      f[j] = d;
      q[qt++] = j;
    }
  }
  return f;
}

/** The walkable neighbour (8-way) that is nearest to a hero (or down `field`), as a direction. */
export function flowDir(a: Arena, x: number, y: number, field = a.flow): { dx: number; dy: number } | null {
  const tx = Math.floor(x / T);
  const ty = Math.floor(y / T);
  const here = field[ty * a.w + tx];
  let best = here < 0 ? 1e9 : here;
  let bx = 0;
  let by = 0;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue;
      const nx = tx + ox;
      const ny = ty + oy;
      if (nx < 0 || ny < 0 || nx >= a.w || ny >= a.h) continue;
      const v = field[ny * a.w + nx];
      if (v < 0) continue;
      if (solidMove(a.tiles[ny * a.w + nx])) continue;
      // no corner cutting
      if (ox && oy && (solidMove(a.tiles[ty * a.w + nx]) || solidMove(a.tiles[ny * a.w + tx]))) continue;
      const score = v + (ox && oy ? 0.4 : 0);
      if (score < best) {
        best = score;
        bx = ox;
        by = oy;
      }
    }
  }
  if (!bx && !by) return null;
  // aim at the centre of that tile, so bodies stay off the corners
  const cx = (tx + bx + 0.5) * T - x;
  const cy = (ty + by + 0.5) * T - y;
  const d = Math.hypot(cx, cy) || 1;
  return { dx: cx / d, dy: cy / d };
}

/**
 * Generate one floor. The left half is built from stamps, then mirrored.
 * A stamp that would cut off part of the floor is undone, so every tile can
 * be walked to.
 */
export function generateArena(seed: number, floor: number, boss: boolean): Arena {
  const rng = new Rng(seed * 7919 + floor * 104729);
  const w = boss ? 30 : 26 + 2 * rng.int(0, 3);
  const h = boss ? 30 : 30 + 2 * rng.int(0, 4);
  const tiles = new Uint8Array(w * h);
  const half = Math.ceil(w / 2);
  const set = (x: number, y: number, t: number) => {
    if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) return;
    tiles[y * w + x] = t;
    tiles[y * w + (w - 1 - x)] = t;
  };
  const get = (x: number, y: number) => tiles[y * w + x];
  for (let x = 0; x < w; x++) {
    tiles[x] = WALL;
    tiles[(h - 1) * w + x] = WALL;
  }
  for (let y = 0; y < h; y++) {
    tiles[y * w] = WALL;
    tiles[y * w + w - 1] = WALL;
  }
  const startX = Math.floor(w / 2);
  const startY = h - 3;
  const liftX = Math.floor(w / 2);
  const liftY = 2;
  // Keep the start and the lift clear.
  const keepClear = (x: number, y: number) => (Math.abs(x - startX) <= 2 && Math.abs(y - startY) <= 2) || (Math.abs(x - liftX) <= 2 && y <= liftY + 2);

  const connected = (): boolean => {
    const seen = new Uint8Array(w * h);
    const q = [startY * w + startX];
    seen[q[0]] = 1;
    let n = 0;
    while (q.length) {
      const i = q.pop()!;
      n++;
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j < 0 || j >= w * h || seen[j]) continue;
        const t = tiles[j];
        if (t === WALL || t === PIT || t === CRATE || t === BARREL) continue;
        seen[j] = 1;
        q.push(j);
      }
    }
    let open = 0;
    for (let i = 0; i < w * h; i++) {
      const t = tiles[i];
      if (t !== WALL && t !== PIT && t !== CRATE && t !== BARREL) open++;
    }
    return n === open;
  };

  // A walkable tile with WALL on both opposite sides is a corridor one tile
  // wide. A hero fits through it, but the biggest enemies do not (their
  // radius is more than half a tile), so they wedge against the wall
  // forever and the floor can never clear. Crates and barrels pinch the
  // same way but are destructible, so they are not a permanent trap.
  const hasWallPinch = (): boolean => {
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const t = tiles[y * w + x];
        if (t === WALL || t === PIT) continue;
        if (tiles[y * w + x - 1] === WALL && tiles[y * w + x + 1] === WALL) return true;
        if (tiles[(y - 1) * w + x] === WALL && tiles[(y + 1) * w + x] === WALL) return true;
      }
    }
    return false;
  };

  const stamp = (cells: [number, number, number][]): boolean => {
    const before = tiles.slice();
    for (const [x, y, t] of cells) {
      if (x < 1 || y < 1 || x >= half || y >= h - 1) continue;
      if (keepClear(x, y)) continue;
      if (get(x, y) !== FLOOR) continue;
      set(x, y, t);
    }
    if (!connected() || hasWallPinch()) {
      tiles.set(before);
      return false;
    }
    return true;
  };

  // A channel of the rapids across the middle on some floors, with bridges.
  if (!boss && rng.chance(0.35)) {
    const y = Math.floor(h / 2) + rng.int(-3, 3);
    const bridges = new Set<number>([1 + rng.int(1, 3), half - 2]);
    for (let x = 1; x < half; x++) {
      if (bridges.has(x) || bridges.has(x - 1)) continue;
      set(x, y, PIT);
      if (rng.chance(0.5)) set(x, y + 1, PIT);
    }
    if (!connected()) for (let x = 1; x < half; x++) if (get(x, y) === PIT) set(x, y, FLOOR);
  }

  const shapes = boss ? 5 : 9 + rng.int(0, 5);
  for (let k = 0; k < shapes; k++) {
    const x = rng.int(2, half - 2);
    const y = rng.int(3, h - 5);
    const kind = rng.weighted(STAMPS, (k) => STAMP_WEIGHT[k]);
    const cells: [number, number, number][] = [];
    switch (kind) {
      case 'wall': {
        const len = rng.int(3, 6);
        const horiz = rng.chance(0.6);
        for (let i = 0; i < len; i++) cells.push(horiz ? [x + i, y, WALL] : [x, y + i, WALL]);
        break;
      }
      case 'lwall': {
        const a = rng.int(2, 4);
        const b = rng.int(2, 4);
        const sx = rng.chance(0.5) ? 1 : -1;
        const sy = rng.chance(0.5) ? 1 : -1;
        for (let i = 0; i < a; i++) cells.push([x + i * sx, y, WALL]);
        for (let i = 1; i < b; i++) cells.push([x, y + i * sy, WALL]);
        break;
      }
      case 'crates': {
        const n = rng.int(2, 5);
        for (let i = 0; i < n; i++) cells.push([x + rng.int(0, 2), y + rng.int(0, 1), CRATE]);
        break;
      }
      case 'bush': {
        const rw = rng.int(2, 4);
        const rh = rng.int(2, 3);
        for (let oy = 0; oy < rh; oy++) for (let ox = 0; ox < rw; ox++) if (rng.chance(0.85)) cells.push([x + ox, y + oy, BUSH]);
        break;
      }
      case 'barrels':
        cells.push([x, y, BARREL]);
        if (rng.chance(0.5)) cells.push([x + 1, y, BARREL]);
        cells.push([x, y + 1, CRATE]);
        break;
      case 'pillar':
        cells.push([x, y, WALL], [x + 1, y, WALL], [x, y + 1, WALL], [x + 1, y + 1, WALL]);
        break;
      case 'vent':
        cells.push([x, y, VENT]);
        break;
    }
    stamp(cells);
  }
  // A ring of bushes near the start gives the first fight a place to hide.
  stamp([
    [startX - 5, startY - 4, BUSH],
    [startX - 6, startY - 4, BUSH],
    [startX - 5, startY - 5, BUSH],
    [startX - 6, startY - 5, BUSH],
  ]);

  const hp = new Float32Array(w * h);
  const vents: { i: number; t: number }[] = [];
  for (let i = 0; i < w * h; i++) {
    if (tiles[i] === CRATE) hp[i] = CRATE_HP;
    if (tiles[i] === BARREL) hp[i] = BARREL_HP;
    if (tiles[i] === VENT) vents.push({ i, t: rng.range(0, 4) });
  }
  return {
    w,
    h,
    tiles,
    hp,
    startX: (startX + 0.5) * T,
    startY: (startY + 0.5) * T,
    liftX: (liftX + 0.5) * T,
    liftY: (liftY + 0.5) * T,
    flow: new Int16Array(w * h).fill(-1),
    vents,
    style: Math.floor((floor - 1) / 5) % 4,
  };
}

const STAMPS = ['wall', 'lwall', 'crates', 'bush', 'barrels', 'pillar', 'vent'] as const;
const STAMP_WEIGHT: Record<(typeof STAMPS)[number], number> = { wall: 3, lwall: 2, crates: 3, bush: 4, barrels: 1.5, pillar: 2, vent: 0.8 };

/** Floor tiles at least `minDist` from (x, y), for spawning. */
export function spawnTiles(a: Arena, x: number, y: number, minDist: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < a.w * a.h; i++) {
    const t = a.tiles[i];
    if (t !== FLOOR && t !== BUSH) continue;
    const tx = i % a.w;
    const ty = (i - tx) / a.w;
    if (tx < 2 || ty < 2 || tx > a.w - 3 || ty > a.h - 3) continue;
    if (Math.hypot((tx + 0.5) * T - x, (ty + 0.5) * T - y) < minDist) continue;
    if (a.flow[i] < 0) continue;
    out.push(i);
  }
  return out;
}
