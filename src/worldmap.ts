import * as ROT from 'rot-js';
import { seedRng } from './rng';

export const TILE = 1; // world units per grid cell

/** Grid cell → world coordinate (cell centre). */
export const cellToWorld = (c: number) => c * TILE;

/** World coordinate → grid cell. */
export const worldToCell = (w: number) => Math.round(w / TILE);

// Cell bounds consistent with worldToCell's rounding: cell c spans
// [c - 0.5, c + 0.5] · TILE. Every piece of collision code must use these —
// a floor()-based version would be off by half a tile.
const cellMin = (c: number) => (c - 0.5) * TILE;
const cellMax = (c: number) => (c + 0.5) * TILE;

export type Cell = 0 | 1; // 0 = floor, 1 = solid

/**
 * Layout archetypes — the area's "level profile". One is rolled per area and
 * decides what gets placed on the open ground, so consecutive areas read as
 * different places rather than the same noise reshuffled.
 */
export type Layout = 'plains' | 'ruins' | 'canyon' | 'colosseum' | 'caverns';

/** An open fight pocket. Obstacle stamps refuse to write inside one, so the
 *  arenas survive whatever the layout builds around them. */
export interface Arena {
  x: number;
  z: number;
  r: number;
}

/** What a cell IS, beyond blocking. Solid kinds (rock, ruin) block the same;
 *  grass is a FLOOR kind — walkable, but it conceals whoever stands in it
 *  from mob eyesight (see systems' perception gate). */
export const KIND_FLOOR = 0;
export const KIND_ROCK = 1;
export const KIND_RUIN = 2;
export const KIND_GRASS = 3;
/** Destructibles: solid kinds stamped AFTER generation (by the area spawn
 *  code), each backed by an ECS entity with health. When one dies its cell
 *  is carved back to floor — collision/LOS/A* honor that immediately. */
export const KIND_CRATE = 4;
export const KIND_BARREL = 5;

export interface GameMap {
  width: number;
  height: number;
  /** Row-major grid, indexed [z * width + x]. */
  cells: Uint8Array;
  /** Per-cell kind (KIND_*), same indexing — rendering flavor only. */
  kinds: Uint8Array;
  /** Area palette, rolled with the map so the biome varies per seed. */
  palette: { ground: string; rock: string; ruin: string; grass: string };
  /** Which archetype built this area — HUD flavor and spawn placement. */
  layout: Layout;
  /** Open fight pockets, ordered west → east: the first is the entry plaza,
   *  the last the exit plaza, with the roamed pockets between. Spawn code
   *  centers packs on these so fights happen in the open. */
  arenas: Arena[];
  /** Walkable floor cells, in row-major order. */
  floors: Array<{ x: number; z: number }>;
  /** Where the player enters the area: floor cell nearest the west edge. */
  entry: { x: number; z: number };
  /** Stepping here leaves the area: floor cell nearest the east edge. */
  exit: { x: number; z: number };
  isWall: (x: number, z: number) => boolean;
  /** Walkable grass at this cell — concealment, not collision. */
  isGrass: (x: number, z: number) => boolean;
}

/** Muted hsl → hex, for the rolled area palettes. */
function hsl(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// ---------------------------------------------------------------------------
// Generation
//
// The ground starts OPEN and obstacles are placed onto it (additive). The
// previous generator was subtractive — fill the field with cellular-automata
// rock, then carve roads through it — which is how you build a cave system,
// and it read as one: corridors between pockets, whatever the seed. Starting
// open and dropping cover onto it is how arena/action games lay out a field,
// and open space is then the default rather than something carving has to
// win back.
//
// Variety comes from LAYOUT ARCHETYPES (the roguelike "level profile"): the
// area rolls one recipe out of five and that recipe composes stamps from a
// shared kit. Every layout keeps the same skeleton — an arena spine west →
// east, roads joining it, cover between — so the game underneath is constant
// while the place changes.
// ---------------------------------------------------------------------------

/** The mutable grid a layout builds into, plus the pockets it must not fill. */
interface Grid {
  width: number;
  height: number;
  cells: Uint8Array;
  kinds: Uint8Array;
  keepClear: Arena[];
}

const TAU = Math.PI * 2;

const inBounds = (g: Grid, x: number, z: number) =>
  x >= 1 && z >= 1 && x <= g.width - 2 && z <= g.height - 2;

/** Inside a fight pocket — where obstacle stamps decline to write. */
const isKeptClear = (g: Grid, x: number, z: number) =>
  g.keepClear.some((a) => (x - a.x) ** 2 + (z - a.z) ** 2 <= a.r * a.r);

/** Place a solid cell, unless it would fill a fight pocket. */
function solid(g: Grid, x: number, z: number, kind: number): void {
  const cx = Math.round(x);
  const cz = Math.round(z);
  if (!inBounds(g, cx, cz) || isKeptClear(g, cx, cz)) return;
  g.cells[cz * g.width + cx] = 1;
  g.kinds[cz * g.width + cx] = kind;
}

function carve(g: Grid, x: number, z: number): void {
  const cx = Math.round(x);
  const cz = Math.round(z);
  if (!inBounds(g, cx, cz)) return;
  g.cells[cz * g.width + cx] = 0;
  g.kinds[cz * g.width + cx] = KIND_FLOOR;
}

function fillDisc(g: Grid, cx: number, cz: number, r: number, kind: number): void {
  for (let z = Math.ceil(cz - r); z <= Math.floor(cz + r); z++) {
    for (let x = Math.ceil(cx - r); x <= Math.floor(cx + r); x++) {
      if ((x - cx) ** 2 + (z - cz) ** 2 <= r * r) solid(g, x, z, kind);
    }
  }
}

function carveDisc(g: Grid, cx: number, cz: number, r: number): void {
  for (let z = Math.ceil(cz - r); z <= Math.floor(cz + r); z++) {
    for (let x = Math.ceil(cx - r); x <= Math.floor(cx + r); x++) {
      if ((x - cx) ** 2 + (z - cz) ** 2 <= r * r) carve(g, x, z);
    }
  }
}

// --- The stamp kit: every layout is a composition of these -----------------

/** A rock mass whose radius breathes with angle, so clusters read weathered
 *  rather than stamped from a cookie cutter. */
function blob(g: Grid, cx: number, cz: number, r: number, kind: number): void {
  const phase = ROT.RNG.getUniform() * TAU;
  const wobble = 0.2 + ROT.RNG.getUniform() * 0.25;
  for (let z = Math.ceil(cz - r); z <= Math.floor(cz + r); z++) {
    for (let x = Math.ceil(cx - r); x <= Math.floor(cx + r); x++) {
      const a = Math.atan2(z - cz, x - cx);
      const rr = r * (1 - wobble + wobble * Math.cos(3 * a + phase));
      if ((x - cx) ** 2 + (z - cz) ** 2 <= rr * rr) solid(g, x, z, kind);
    }
  }
}

/** A ruined building: walled shell, cleared floor, doorways on opposite
 *  walls, and gap-toothed masonry. Cover you can fight *inside*, not a
 *  sealed box — the doorways and gaps make it a two-way position. */
function shell(g: Grid, x: number, z: number, w: number, h: number): void {
  if (w < 4 || h < 4) return;
  for (let zz = z; zz < z + h; zz++) {
    for (let xx = x; xx < x + w; xx++) {
      const edge = xx === x || zz === z || xx === x + w - 1 || zz === z + h - 1;
      // Weathering: a fraction of the wall has already fallen.
      if (edge && ROT.RNG.getUniform() > 0.12) solid(g, xx, zz, KIND_RUIN);
      else carve(g, xx, zz);
    }
  }
  const doorX = x + 1 + ROT.RNG.getUniformInt(0, w - 3);
  const doorZ = z + 1 + ROT.RNG.getUniformInt(0, h - 3);
  carve(g, doorX, z);
  carve(g, doorX, z + h - 1);
  if (ROT.RNG.getUniform() < 0.6) {
    carve(g, x, doorZ);
    carve(g, x + w - 1, doorZ);
  }
}

/** Free-standing pillars on a loose grid — the most permeable cover there
 *  is: blocks line of sight and bullets, never blocks movement. */
function pillarCourt(g: Grid, x: number, z: number, w: number, h: number, kind: number): void {
  const step = 3 + ROT.RNG.getUniformInt(0, 1);
  for (let zz = z; zz < z + h; zz += step) {
    for (let xx = x; xx < x + w; xx += step) {
      if (ROT.RNG.getUniform() < 0.75) {
        solid(g, xx + ROT.RNG.getUniformInt(0, 1), zz + ROT.RNG.getUniformInt(0, 1), kind);
      }
    }
  }
}

/** A thick line with gaps knocked through it — a ridge wall. The gaps are
 *  the point: they make flanking routes instead of a hard partition. */
function ridge(
  g: Grid,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  thick: number,
  kind: number,
  gaps: number,
): void {
  const len = Math.hypot(bx - ax, bz - az);
  if (len < 1) return;
  const gapAt: number[] = [];
  for (let i = 0; i < gaps; i++) gapAt.push(0.15 + ROT.RNG.getUniform() * 0.7);
  const gapHalf = 2.5 / len; // ~5 cells of opening
  const steps = Math.ceil(len * 2);
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    if (gapAt.some((gt) => Math.abs(t - gt) < gapHalf)) continue;
    fillDisc(g, ax + (bx - ax) * t, az + (bz - az) * t, thick / 2, kind);
  }
}

/** A ring wall with gates: the colosseum shape. Entering means committing
 *  through a gate, which is what makes an arena fight an arena fight. */
function brokenRing(
  g: Grid,
  cx: number,
  cz: number,
  r: number,
  thick: number,
  kind: number,
  gates: number,
): void {
  const offset = ROT.RNG.getUniform() * TAU;
  const gateHalf = 0.16 + ROT.RNG.getUniform() * 0.1; // radians
  const steps = Math.max(24, Math.ceil(TAU * r * 2));
  for (let s = 0; s < steps; s++) {
    const a = (s / steps) * TAU;
    let inGate = false;
    for (let k = 0; k < gates; k++) {
      const ga = offset + (k / gates) * TAU;
      // Shortest angular distance to this gate's centre.
      const d = Math.abs(((a - ga + Math.PI * 3) % TAU) - Math.PI);
      if (d < gateHalf) inGate = true;
    }
    if (inGate) continue;
    fillDisc(g, cx + Math.cos(a) * r, cz + Math.sin(a) * r, thick / 2, kind);
  }
}

/** Dart-thrown scatter points with a minimum separation (Poisson-disc by
 *  rejection — n is small enough that the naive O(n²) test is free). Skips
 *  the fight pockets so features cluster in the space between them. */
function scatter(g: Grid, minDist: number, margin: number, tries: number): Array<{ x: number; z: number }> {
  const pts: Array<{ x: number; z: number }> = [];
  for (let i = 0; i < tries; i++) {
    const x = margin + ROT.RNG.getUniform() * (g.width - 2 * margin);
    const z = margin + ROT.RNG.getUniform() * (g.height - 2 * margin);
    if (isKeptClear(g, Math.round(x), Math.round(z))) continue;
    if (pts.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < minDist * minDist)) continue;
    pts.push({ x, z });
  }
  return pts;
}

// --- Layout archetypes -----------------------------------------------------

/** Open grassland: sparse boulder clusters, the odd homestead ruin. The most
 *  open layout — long sightlines, cover you run *between*. */
function buildPlains(g: Grid): void {
  // Hills first: the only thing out here that breaks a sightline at range.
  for (const p of scatter(g, 15, 8, 150)) blob(g, p.x, p.z, 3.5 + ROT.RNG.getUniform() * 3, KIND_ROCK);
  for (const p of scatter(g, 5, 5, 1200)) {
    const roll = ROT.RNG.getUniform();
    if (roll < 0.7) blob(g, p.x, p.z, 1.6 + ROT.RNG.getUniform() * 2.4, KIND_ROCK);
    else if (roll < 0.88) pillarCourt(g, p.x - 3, p.z - 3, 8, 8, KIND_ROCK);
    else shell(g, Math.round(p.x) - 3, Math.round(p.z) - 3, 6 + ROT.RNG.getUniformInt(0, 3), 6 + ROT.RNG.getUniformInt(0, 3));
  }
}

/** A dead town: blocks of buildings on a street grid. The streets are the
 *  lanes, the shells are the cover, the courtyards are the ambush spots. */
function buildRuins(g: Grid): void {
  const pitch = 11 + ROT.RNG.getUniformInt(0, 4);
  const street = 3;
  for (let bz = 3; bz < g.height - 6; bz += pitch) {
    for (let bx = 3; bx < g.width - 6; bx += pitch) {
      const w = Math.min(pitch - street, g.width - 3 - bx);
      const h = Math.min(pitch - street, g.height - 3 - bz);
      const roll = ROT.RNG.getUniform();
      if (roll < 0.58) {
        shell(g, bx, bz, w - ROT.RNG.getUniformInt(0, 2), h - ROT.RNG.getUniformInt(0, 2));
      } else if (roll < 0.74) {
        pillarCourt(g, bx, bz, w, h, KIND_RUIN);
      } else if (roll < 0.88) {
        blob(g, bx + w / 2, bz + h / 2, 1.5 + ROT.RNG.getUniform() * 2, KIND_ROCK);
      }
      // else: an empty lot — a town needs breathing room too.
    }
  }
}

/** Long ridges running with the run (west → east), gap-toothed: parallel
 *  lanes with cross-cuts. Kiting terrain — you break line of sight by
 *  changing lane, not by hiding behind a rock. */
function buildCanyon(g: Grid): void {
  const lanes = 4 + ROT.RNG.getUniformInt(0, 2);
  for (let i = 0; i < lanes; i++) {
    // Segments wander around the lane's own axis, never away from it: a
    // cumulative random walk lets neighbouring ridges collide and fuse back
    // into the rock continent this layout exists to avoid.
    const axis = Math.round(((i + 1) / (lanes + 1)) * g.height);
    const wander = () => Math.max(3, Math.min(g.height - 4, axis + ROT.RNG.getUniformInt(-3, 3)));
    const thick = 2 + ROT.RNG.getUniformInt(0, 2);
    let x = 2;
    let z = wander();
    while (x < g.width - 3) {
      const nx = Math.min(g.width - 3, x + 8 + ROT.RNG.getUniformInt(0, 8));
      const nz = wander();
      ridge(g, x, z, nx, nz, thick, KIND_ROCK, 1 + ROT.RNG.getUniformInt(0, 1));
      x = nx;
      z = nz;
    }
  }
  // Loose scree in the lanes, so a lane isn't a bare bowling alley.
  for (const p of scatter(g, 6, 6, 600)) blob(g, p.x, p.z, 1 + ROT.RNG.getUniform() * 1.8, KIND_ROCK);
}

/** Walled arenas joined by open outfield: each pocket gets a gated ring, so
 *  the map is a chain of rooms you fight *in* rather than pass through. */
function buildColosseum(g: Grid): void {
  for (const a of g.keepClear) {
    brokenRing(g, a.x, a.z, a.r + 1.5, 2 + ROT.RNG.getUniform(), KIND_RUIN, 3 + ROT.RNG.getUniformInt(0, 1));
  }
  for (const p of scatter(g, 8, 6, 400)) {
    if (ROT.RNG.getUniform() < 0.75) blob(g, p.x, p.z, 1.2 + ROT.RNG.getUniform() * 2, KIND_ROCK);
    else pillarCourt(g, p.x - 2, p.z - 2, 6, 6, KIND_RUIN);
  }
}

/** The old cave look, kept as ONE archetype out of five instead of the only
 *  one — and opened up: low CA fill, then collapsed chambers punched through
 *  it, so it's a cave system with rooms, not a corridor maze. */
function buildCaverns(g: Grid): void {
  const ca = new ROT.Map.Cellular(g.width, g.height);
  // CA equilibrium is touchy: below ~0.44 the rock dissolves to near-empty,
  // ~0.5 holds half the field. Sit just under half, then hollow it out.
  ca.randomize(0.46);
  for (let i = 0; i < 4; i++) ca.create();
  ca.create((x, z, alive) => {
    if (alive) solid(g, x, z, KIND_ROCK);
  });
  const chambers = 6 + ROT.RNG.getUniformInt(0, 5);
  for (let i = 0; i < chambers; i++) {
    carveDisc(
      g,
      6 + ROT.RNG.getUniform() * (g.width - 12),
      6 + ROT.RNG.getUniform() * (g.height - 12),
      3 + ROT.RNG.getUniform() * 3.5,
    );
  }
}

interface LayoutDef {
  weight: number;
  build: (g: Grid) => void;
  /** Hue range and dressing for the biome palette. */
  hue: [number, number];
  /** How much concealment this place grows: multiplier on the grass budget. */
  grass: number;
}

const LAYOUTS: Record<Layout, LayoutDef> = {
  plains: { weight: 0.28, build: buildPlains, hue: [70, 140], grass: 1.6 },
  ruins: { weight: 0.22, build: buildRuins, hue: [20, 55], grass: 0.7 },
  canyon: { weight: 0.2, build: buildCanyon, hue: [5, 35], grass: 0.8 },
  colosseum: { weight: 0.18, build: buildColosseum, hue: [30, 60], grass: 0.9 },
  caverns: { weight: 0.12, build: buildCaverns, hue: [190, 280], grass: 0.5 },
};

/**
 * Generate an area, west → east:
 *
 * 1. Roll a layout archetype (the level profile) and lay the ARENA SPINE:
 *    an entry plaza, two or three fight pockets, an exit plaza. Keep-clear
 *    discs — nothing the layout places can fill them.
 * 2. Run the archetype over the open ground, dropping cover everywhere but
 *    the pockets.
 * 3. Carve roads along the spine (plus a bypass loop, so kiting has
 *    circuits) — a guaranteed walkable route that also reads as worn paths.
 * 4. Furnish the arenas with a little cover: a bare plate is a bad arena.
 * 5. Border, connectivity pass, grass.
 *
 * Everything draws from ROT.RNG (determinism rule); the output keeps the
 * grid shape the sim, pathfinding, and renderer consume.
 */
export function generateWorldMap(width: number, height: number, seed?: number): GameMap {
  if (seed !== undefined) seedRng(seed);

  // Cells start at 0 = open floor. Obstacles are added, not carved out.
  const cells = new Uint8Array(width * height);
  const kinds = new Uint8Array(width * height);
  const g: Grid = { width, height, cells, kinds, keepClear: [] };

  // 1) Layout + arena spine.
  let roll = ROT.RNG.getUniform();
  let layout: Layout = 'plains';
  for (const [name, def] of Object.entries(LAYOUTS) as Array<[Layout, LayoutDef]>) {
    roll -= def.weight;
    if (roll <= 0) {
      layout = name;
      break;
    }
  }
  const def = LAYOUTS[layout];

  const margin = 8;
  const bandZ = () => ROT.RNG.getUniformInt(margin, height - 1 - margin);
  const arenas: Arena[] = [{ x: 6, z: bandZ(), r: 5 + ROT.RNG.getUniform() * 1.5 }];
  const midCount = 2 + ROT.RNG.getUniformInt(0, 1);
  // Mid pockets alternate between the north and south halves: they can never
  // fuse into one continent-sized clearing, and the road between them snakes
  // instead of ruling a line down the middle.
  let side = ROT.RNG.getUniform() < 0.5 ? 0 : 1;
  const half = (height - 2 * margin) / 2;
  for (let i = 0; i < midCount; i++) {
    const t = (i + 1) / (midCount + 1);
    arenas.push({
      x: Math.round(margin + t * (width - 2 * margin)) + ROT.RNG.getUniformInt(-4, 4),
      z: Math.round(margin + side * half + ROT.RNG.getUniform() * half),
      // Big enough to fight a pack in: the old clearings were r≈4, barely
      // wider than the screen's short axis.
      r: 6 + ROT.RNG.getUniform() * 3,
    });
    side ^= 1;
  }
  arenas.push({ x: width - 7, z: bandZ(), r: 5.5 + ROT.RNG.getUniform() * 1.5 });
  g.keepClear = arenas;

  // 2) The archetype builds around the pockets.
  def.build(g);

  // 3) Roads: the spine, then a bypass between the far pockets.
  const carveRoad = (a: Arena, b: Arena, jitter: number) => {
    const mid = {
      x: (a.x + b.x) / 2 + ROT.RNG.getUniformInt(-jitter, jitter),
      z: (a.z + b.z) / 2 + ROT.RNG.getUniformInt(-jitter, jitter),
    };
    for (const [p, q] of [
      [a, mid],
      [mid, b],
    ]) {
      const steps = Math.ceil(Math.hypot(q.x - p.x, q.z - p.z) * 2);
      const r = 1.8 + ROT.RNG.getUniform() * 1.2;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        carveDisc(g, p.x + (q.x - p.x) * t, p.z + (q.z - p.z) * t, r);
      }
    }
  };
  for (let i = 0; i < arenas.length - 1; i++) carveRoad(arenas[i], arenas[i + 1], 5);
  if (arenas.length >= 4) carveRoad(arenas[0], arenas[arenas.length - 1], 14);

  // 4) Arena furniture. Stamped with the keep-clear guard lifted — these ARE
  //    the pockets — and small enough never to wall one off. The middle
  //    stays open so the pocket still plays as a room.
  const guarded = g.keepClear;
  g.keepClear = [];
  for (let i = 1; i < arenas.length; i++) {
    const a = arenas[i];
    const nubs = 2 + ROT.RNG.getUniformInt(0, 3);
    for (let n = 0; n < nubs; n++) {
      const ang = ROT.RNG.getUniform() * TAU;
      const dist = a.r * (0.4 + ROT.RNG.getUniform() * 0.45);
      blob(
        g,
        a.x + Math.cos(ang) * dist,
        a.z + Math.sin(ang) * dist,
        0.9 + ROT.RNG.getUniform() * 1.1,
        layout === 'ruins' || layout === 'colosseum' ? KIND_RUIN : KIND_ROCK,
      );
    }
  }
  g.keepClear = guarded;

  // 5) Border ring: the world ends here.
  for (let x = 0; x < width; x++) {
    cells[x] = 1;
    kinds[x] = KIND_ROCK;
    cells[(height - 1) * width + x] = 1;
    kinds[(height - 1) * width + x] = KIND_ROCK;
  }
  for (let z = 0; z < height; z++) {
    cells[z * width] = 1;
    kinds[z * width] = KIND_ROCK;
    cells[z * width + width - 1] = 1;
    kinds[z * width + width - 1] = KIND_ROCK;
  }

  // Connectivity, in two steps. First JOIN: any sizeable pocket the layout
  // sealed off gets a passage cut to the spine, because that space is worth
  // playing — the old generator simply wrote orphans off as rock, which is
  // how a canyon lost its whole southern third. Then keep only the largest
  // region, so what remains (nooks too small to bother joining) can never
  // strand A* or a spawn.
  joinOrphans(g, arenas);
  const floors = keepLargestRegion(cells, width, height);
  // Pockets the region pass solidified read as rock.
  for (let i = 0; i < cells.length; i++) if (cells[i] === 1 && kinds[i] === KIND_FLOOR) kinds[i] = KIND_ROCK;

  // Entry and exit sit in the end plazas, landing on the surviving region so
  // a walkable route between them always exists.
  const entry = nearestFloor(floors, arenas[0].x, arenas[0].z);
  const exit = nearestFloor(floors, arenas[arenas.length - 1].x, arenas[arenas.length - 1].z);

  // Area palette: the layout picks the hue family (a canyon is rusty, a
  // cavern cold), then the seed picks a shade within it. Ground dark, rock
  // lighter in the same family, ruin masonry fixed so built structure reads
  // the same everywhere.
  const hue = def.hue[0] + ROT.RNG.getUniform() * (def.hue[1] - def.hue[0]);
  const palette = {
    ground: hsl(hue, 0.14, 0.16),
    rock: hsl(hue, 0.17, 0.33),
    ruin: '#6d6353',
    // Grass must read as grass whatever the biome hue — always green-ish.
    grass: hsl(95 + ROT.RNG.getUniform() * 40, 0.35, 0.3),
  };

  // Grass: concealment stamped onto surviving floor — after the region pass
  // so no later carving can orphan it. Fields in the arenas (cover where the
  // fights are) plus a scatter across the field, budgeted by layout.
  const stampGrass = (cx: number, cz: number, r: number) => {
    for (let z = Math.max(1, Math.ceil(cz - r)); z <= Math.min(height - 2, Math.floor(cz + r)); z++) {
      for (let x = Math.max(1, Math.ceil(cx - r)); x <= Math.min(width - 2, Math.floor(cx + r)); x++) {
        if ((x - cx) ** 2 + (z - cz) ** 2 <= r * r && cells[z * width + x] === 0) {
          kinds[z * width + x] = KIND_GRASS;
        }
      }
    }
  };
  for (const a of arenas) {
    const blobs = Math.round((1 + ROT.RNG.getUniformInt(0, 1)) * def.grass);
    for (let i = 0; i < blobs; i++) {
      stampGrass(
        a.x + ROT.RNG.getUniformInt(-4, 4),
        a.z + ROT.RNG.getUniformInt(-4, 4),
        1.5 + ROT.RNG.getUniform() * 2,
      );
    }
  }
  const looseTufts = Math.round((4 + ROT.RNG.getUniformInt(0, 3)) * def.grass);
  for (let i = 0; i < looseTufts; i++) {
    const c = floors[ROT.RNG.getUniformInt(0, floors.length - 1)];
    stampGrass(c.x, c.z, 1.5 + ROT.RNG.getUniform() * 2);
  }

  const isWall = (x: number, z: number) => {
    if (x < 0 || z < 0 || x >= width || z >= height) return true;
    return cells[z * width + x] === 1;
  };
  const isGrass = (x: number, z: number) => {
    if (x < 0 || z < 0 || x >= width || z >= height) return false;
    const i = z * width + x;
    return cells[i] === 0 && kinds[i] === KIND_GRASS;
  };

  return { width, height, cells, kinds, palette, layout, arenas, floors, entry, exit, isWall, isGrass };
}

/** Floor cell closest to a target grid point. */
function nearestFloor(floors: Array<{ x: number; z: number }>, tx: number, tz: number): { x: number; z: number } {
  let best = floors[0];
  let bestD = Infinity;
  for (const c of floors) {
    const d = Math.hypot(c.x - tx, c.z - tz);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/** True if the straight segment between two world points crosses no solid
 *  cell — sampled every quarter-tile, plenty at our obstacle sizes. With
 *  `grassBlocks`, grass cells also break the line: eyes can't pierce a bush
 *  from outside (perception uses this; combat code keeps walls-only). */
export function hasLineOfSight(
  map: GameMap,
  a: { x: number; z: number },
  b: { x: number; z: number },
  grassBlocks = false,
): boolean {
  const dist = Math.hypot(b.x - a.x, b.z - a.z);
  const steps = Math.ceil(dist / (TILE * 0.25));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const cx = worldToCell(a.x + (b.x - a.x) * t);
    const cz = worldToCell(a.z + (b.z - a.z) * t);
    if (map.isWall(cx, cz)) return false;
    if (grassBlocks && map.isGrass(cx, cz)) return false;
  }
  return true;
}

/** Flood-fill the floor into connected regions (deterministic scan order).
 *  Returns a per-cell region id (-1 for solid) and each region's cells. */
function labelRegions(cells: Uint8Array, width: number, height: number): { region: Int32Array; members: number[][] } {
  const region = new Int32Array(cells.length).fill(-1);
  const members: number[][] = [];

  for (let start = 0; start < cells.length; start++) {
    if (cells[start] === 1 || region[start] !== -1) continue;
    const id = members.length;
    const cellsOfRegion: number[] = [];
    const stack = [start];
    region[start] = id;
    while (stack.length > 0) {
      const i = stack.pop()!;
      cellsOfRegion.push(i);
      const x = i % width;
      const z = (i - x) / width;
      for (const [nx, nz] of [[x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]]) {
        if (nx < 0 || nz < 0 || nx >= width || nz >= height) continue;
        const ni = nz * width + nx;
        if (cells[ni] === 0 && region[ni] === -1) {
          region[ni] = id;
          stack.push(ni);
        }
      }
    }
    members.push(cellsOfRegion);
  }
  return { region, members };
}

/** Space a layout accidentally sealed off is space the player never sees.
 *  Every pocket big enough to fight in gets a passage bored from its nearest
 *  cell to the nearest arena — the arenas are strung together by the road
 *  spine, so reaching one reaches everything. Pockets smaller than a swing
 *  radius aren't worth a tunnel; the region pass mops those up. */
function joinOrphans(g: Grid, arenas: Arena[]): void {
  const { width, cells } = g;
  const { members } = labelRegions(cells, width, g.height);
  if (members.length < 2) return;
  let main = 0;
  for (let i = 1; i < members.length; i++) if (members[i].length > members[main].length) main = i;

  for (let id = 0; id < members.length; id++) {
    if (id === main || members[id].length < 25) continue;
    // The pair (cell in this pocket, arena) with the shortest gap.
    let best = { d: Infinity, x: 0, z: 0, a: arenas[0] };
    for (const i of members[id]) {
      const x = i % width;
      const z = (i - x) / width;
      for (const a of arenas) {
        const d = (a.x - x) ** 2 + (a.z - z) ** 2;
        if (d < best.d) best = { d, x, z, a };
      }
    }
    const steps = Math.ceil(Math.sqrt(best.d) * 2);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      carveDisc(g, best.x + (best.a.x - best.x) * t, best.z + (best.a.z - best.z) * t, 1.4);
    }
  }
}

/** Solidify every floor region but the largest, and return its cells in
 *  row-major order (deterministic). */
function keepLargestRegion(cells: Uint8Array, width: number, height: number): Array<{ x: number; z: number }> {
  const { region, members } = labelRegions(cells, width, height);
  const sizes = members.map((m) => m.length);
  const largest = sizes.indexOf(Math.max(...sizes));
  const floors: Array<{ x: number; z: number }> = [];
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] === 0 && region[i] !== largest) cells[i] = 1;
    if (cells[i] === 0) floors.push({ x: i % width, z: Math.floor(i / width) });
  }
  return floors;
}

/**
 * Move a collision circle by vel·dt: integrate the full step, then push the
 * circle out of any overlapping solid cell along the shortest separation
 * vector, iterating until clear. Mutates `pos`.
 *
 * Face contacts push perpendicular to the wall, so sliding along faces falls
 * out for free; corner contacts push radially from the corner point, so
 * bodies round corners smoothly. (The previous axis-separated clamp treated
 * a corner as blocking both axes at once — bodies deadlocked on corner
 * points and corridor mouths.) Deepest overlap resolves first each round,
 * so a face beats the phantom corner of the neighbouring wall cell.
 *
 * No tunnel risk at our speeds (~0.1 u/frame vs r ≥ 0.2): the centre can
 * never cross into a solid cell in one step, so the closest-point normal is
 * always well-defined. Faster movers would need substepping.
 */
export function moveCircle(
  map: GameMap,
  pos: { x: number; z: number },
  vel: { x: number; z: number },
  r: number,
  dt: number,
): void {
  pos.x += vel.x * dt;
  pos.z += vel.z * dt;

  for (let iter = 0; iter < 5; iter++) {
    let depth = 0;
    let pushX = 0;
    let pushZ = 0;
    for (let cz = worldToCell(pos.z - r); cz <= worldToCell(pos.z + r); cz++) {
      for (let cx = worldToCell(pos.x - r); cx <= worldToCell(pos.x + r); cx++) {
        if (!map.isWall(cx, cz)) continue;
        const dx = pos.x - Math.min(Math.max(pos.x, cellMin(cx)), cellMax(cx));
        const dz = pos.z - Math.min(Math.max(pos.z, cellMin(cz)), cellMax(cz));
        const d = Math.hypot(dx, dz);
        if (d >= r || r - d <= depth) continue;
        depth = r - d;
        if (d > 0) {
          pushX = dx / d;
          pushZ = dz / d;
        } else {
          // Centre exactly on the cell boundary — unreachable at game
          // speeds, but keep the normal defined: back straight out.
          const vl = Math.hypot(vel.x, vel.z) || 1;
          pushX = -vel.x / vl;
          pushZ = -vel.z / vl;
        }
      }
    }
    if (depth === 0) break;
    // A hair past tangency, so the same contact doesn't re-trigger.
    pos.x += pushX * (depth + 1e-4);
    pos.z += pushZ * (depth + 1e-4);
  }
}

/** True if a circle at (x, z) overlaps any solid cell (projectile impacts). */
export function circleOverlapsWall(map: GameMap, x: number, z: number, r: number): boolean {
  return overlappingWallCell(map, x, z, r) !== null;
}

/** The first solid cell (deterministic row-major scan) a circle at (x, z)
 *  overlaps, or null — so projectile impacts can ask WHAT they hit and
 *  route the hit to a destructible's entity when one occupies the cell. */
export function overlappingWallCell(
  map: GameMap,
  x: number,
  z: number,
  r: number,
): { x: number; z: number } | null {
  for (let cz = worldToCell(z - r); cz <= worldToCell(z + r); cz++) {
    for (let cx = worldToCell(x - r); cx <= worldToCell(x + r); cx++) {
      if (!map.isWall(cx, cz)) continue;
      const dx = x - Math.min(Math.max(x, cellMin(cx)), cellMax(cx));
      const dz = z - Math.min(Math.max(z, cellMin(cz)), cellMax(cz));
      if (dx * dx + dz * dz < r * r) return { x: cx, z: cz };
    }
  }
  return null;
}
