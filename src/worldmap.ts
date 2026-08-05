import * as ROT from 'rot-js';

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

/**
 * Generate an overworld with actual terrain structure, west → east:
 *
 * 1. Cellular-automata rock masses (per-area rockiness roll, so one area
 *    reads as open plains and the next as a boulder maze).
 * 2. Ruins: broken rectangular shells with doorways — hard cover to fight
 *    around. Stamped before the roads so a road can breach a wall.
 * 3. Arenas: circular clearings strung across the map — the fight pockets.
 * 4. Roads: jittered polylines carved entry → arenas → exit (plus a loop
 *    between arenas when there are enough). The carve guarantees a walkable
 *    route; where a road squeezes past a rock mass, a chokepoint falls out.
 *
 * Everything draws from ROT.RNG (determinism rule); the output keeps the
 * grid shape the sim, pathfinding, and renderer consume.
 */
export function generateWorldMap(width: number, height: number, seed?: number): GameMap {
  if (seed !== undefined) ROT.RNG.setSeed(seed);

  const cells = new Uint8Array(width * height);
  const kinds = new Uint8Array(width * height);
  const solid = (x: number, z: number, kind: number) => {
    cells[z * width + x] = 1;
    kinds[z * width + x] = kind;
  };
  const carve = (x: number, z: number) => {
    if (x >= 1 && z >= 1 && x <= width - 2 && z <= height - 2) {
      cells[z * width + x] = 0;
      kinds[z * width + x] = KIND_FLOOR;
    }
  };
  const carveDisc = (cx: number, cz: number, r: number) => {
    for (let z = Math.ceil(cz - r); z <= Math.floor(cz + r); z++) {
      for (let x = Math.ceil(cx - r); x <= Math.floor(cx + r); x++) {
        if ((x - cx) ** 2 + (z - cz) ** 2 <= r * r) carve(x, z);
      }
    }
  };

  // 1) Rock masses: a few CA generations smooth seeded noise into blobs.
  // CA equilibrium is touchy: below ~0.44 the rock dissolves to near-empty,
  // around 0.5 it holds ~half the field. This range lands 35–55% rock before
  // the roads/arenas carve it back open.
  const rockiness = 0.44 + ROT.RNG.getUniform() * 0.08;
  const ca = new ROT.Map.Cellular(width, height);
  ca.randomize(rockiness);
  for (let g = 0; g < 3; g++) ca.create();
  ca.create((x, z, alive) => {
    if (alive) solid(x, z, KIND_ROCK);
  });

  // Area palette: one hue anchors the biome; ground dark, rock lighter in
  // the same family, ruin masonry fixed so built structure reads the same
  // everywhere.
  const hue = ROT.RNG.getUniform() * 360;
  const palette = {
    ground: hsl(hue, 0.14, 0.16),
    rock: hsl(hue, 0.17, 0.33),
    ruin: '#6d6353',
    // Grass must read as grass whatever the biome hue — always green-ish.
    grass: hsl(95 + ROT.RNG.getUniform() * 40, 0.35, 0.3),
  };

  // 2) Ruins: wall the shell, clear the floor, knock a doorway in two
  //    opposite walls. Roads carved later may breach them further.
  const ruinCount = 2 + ROT.RNG.getUniformInt(0, 2);
  for (let i = 0; i < ruinCount; i++) {
    const rw = 5 + ROT.RNG.getUniformInt(0, 4);
    const rh = 5 + ROT.RNG.getUniformInt(0, 4);
    const rx = ROT.RNG.getUniformInt(3, width - 4 - rw);
    const rz = ROT.RNG.getUniformInt(3, height - 4 - rh);
    for (let z = rz; z < rz + rh; z++) {
      for (let x = rx; x < rx + rw; x++) {
        const edge = x === rx || z === rz || x === rx + rw - 1 || z === rz + rh - 1;
        if (edge) solid(x, z, KIND_RUIN);
        else carve(x, z);
      }
    }
    const doorX = rx + 1 + ROT.RNG.getUniformInt(0, rw - 3);
    const doorZ = rz + 1 + ROT.RNG.getUniformInt(0, rh - 3);
    carve(doorX, rz);
    carve(doorX, rz + rh - 1);
    if (ROT.RNG.getUniform() < 0.5) {
      carve(rx, doorZ);
      carve(rx + rw - 1, doorZ);
    }
  }

  // 3) Arenas: clearings spaced across the west→east axis, jittered so the
  //    road through them winds instead of ruling a straight line.
  const margin = 7;
  const arenaCount = 3 + ROT.RNG.getUniformInt(0, 2);
  const arenas: Array<{ x: number; z: number }> = [];
  for (let i = 0; i < arenaCount; i++) {
    const ax = Math.round(margin + ((i + 0.5) / arenaCount) * (width - 2 * margin)) + ROT.RNG.getUniformInt(-3, 3);
    const az = ROT.RNG.getUniformInt(margin, height - 1 - margin);
    carveDisc(ax, az, 3 + ROT.RNG.getUniform() * 2.5);
    arenas.push({ x: ax, z: az });
  }

  // 4) Roads: carve entry → arenas → exit with a jittered midpoint per leg.
  const entryPt = { x: 1, z: ROT.RNG.getUniformInt(margin, height - 1 - margin) };
  const exitPt = { x: width - 2, z: ROT.RNG.getUniformInt(margin, height - 1 - margin) };
  const carveRoad = (a: { x: number; z: number }, b: { x: number; z: number }) => {
    const mid = {
      x: (a.x + b.x) / 2 + ROT.RNG.getUniformInt(-4, 4),
      z: (a.z + b.z) / 2 + ROT.RNG.getUniformInt(-4, 4),
    };
    for (const [p, q] of [
      [a, mid],
      [mid, b],
    ]) {
      const steps = Math.ceil(Math.hypot(q.x - p.x, q.z - p.z) * 2);
      const r = 1.1 + ROT.RNG.getUniform() * 0.5;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        carveDisc(p.x + (q.x - p.x) * t, p.z + (q.z - p.z) * t, r);
      }
    }
  };
  const waypoints = [entryPt, ...arenas, exitPt];
  for (let i = 0; i < waypoints.length - 1; i++) carveRoad(waypoints[i], waypoints[i + 1]);
  // A loop between non-adjacent arenas: kiting wants circuits, not dead ends.
  if (arenaCount >= 3) carveRoad(arenas[0], arenas[arenaCount - 1]);

  // Border ring: the world ends here.
  for (let x = 0; x < width; x++) {
    solid(x, 0, KIND_ROCK);
    solid(x, height - 1, KIND_ROCK);
  }
  for (let z = 0; z < height; z++) {
    solid(0, z, KIND_ROCK);
    solid(width - 1, z, KIND_ROCK);
  }

  // Connectivity: keep only the largest floor region so A* and spawns can
  // never be stranded in a walled-off pocket; other pockets become solid.
  const floors = keepLargestRegion(cells, width, height);
  // Pockets the region pass solidified read as rock.
  for (let i = 0; i < cells.length; i++) if (cells[i] === 1 && kinds[i] === KIND_FLOOR) kinds[i] = KIND_ROCK;

  // Entry and exit land on the surviving region nearest the road's own
  // endpoints, so a walkable route between them always exists.
  const entry = nearestFloor(floors, entryPt.x, entryPt.z);
  const exit = nearestFloor(floors, exitPt.x, exitPt.z);

  // 5) Grass: concealment blobs stamped onto surviving floor — after the
  //    region pass so no later carving can orphan them. Anchored on the
  //    arenas (cover where the fights are) plus a scatter of loose tufts.
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
    const blobs = 1 + ROT.RNG.getUniformInt(0, 1);
    for (let i = 0; i < blobs; i++) {
      stampGrass(
        a.x + ROT.RNG.getUniformInt(-3, 3),
        a.z + ROT.RNG.getUniformInt(-3, 3),
        1.5 + ROT.RNG.getUniform() * 1.5,
      );
    }
  }
  const looseTufts = 3 + ROT.RNG.getUniformInt(0, 2);
  for (let i = 0; i < looseTufts; i++) {
    const c = floors[ROT.RNG.getUniformInt(0, floors.length - 1)];
    stampGrass(c.x, c.z, 1.5 + ROT.RNG.getUniform() * 1.5);
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

  return { width, height, cells, kinds, palette, floors, entry, exit, isWall, isGrass };
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

/** Flood-fill floor regions, solidify all but the largest, return its cells
 *  in row-major order (deterministic). */
function keepLargestRegion(cells: Uint8Array, width: number, height: number): Array<{ x: number; z: number }> {
  const region = new Int32Array(cells.length).fill(-1);
  const sizes: number[] = [];

  for (let start = 0; start < cells.length; start++) {
    if (cells[start] === 1 || region[start] !== -1) continue;
    const id = sizes.length;
    let size = 0;
    const stack = [start];
    region[start] = id;
    while (stack.length > 0) {
      const i = stack.pop()!;
      size++;
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
    sizes.push(size);
  }

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
