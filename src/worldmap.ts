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

export interface GameMap {
  width: number;
  height: number;
  /** Row-major grid, indexed [z * width + x]. */
  cells: Uint8Array;
  /** Walkable floor cells, in row-major order. */
  floors: Array<{ x: number; z: number }>;
  /** Where the player enters the area: floor cell nearest the west edge. */
  entry: { x: number; z: number };
  /** Stepping here leaves the area: floor cell nearest the east edge. */
  exit: { x: number; z: number };
  isWall: (x: number, z: number) => boolean;
}

/**
 * Generate an open overworld: a mostly-walkable field with scattered obstacle
 * clusters (rocks/ruins/copses as far as the renderer cares), ringed by a
 * solid border. Seeded for reproducibility. rot.js has no open-field
 * generator, so this is a small scatter of RNG-driven random walks; the
 * output keeps the same grid shape the pathfinding and renderer consume.
 */
export function generateWorldMap(width: number, height: number, seed?: number): GameMap {
  if (seed !== undefined) ROT.RNG.setSeed(seed);

  const cells = new Uint8Array(width * height); // start all floor
  for (let x = 0; x < width; x++) {
    cells[x] = 1;
    cells[(height - 1) * width + x] = 1;
  }
  for (let z = 0; z < height; z++) {
    cells[z * width] = 1;
    cells[z * width + width - 1] = 1;
  }

  // Obstacle clusters: short random walks marking cells solid → blobby
  // clumps at ~10–15% density, the "open with scattered cover" read.
  const clusterCount = Math.floor((width * height) / 60);
  for (let i = 0; i < clusterCount; i++) {
    let x = ROT.RNG.getUniformInt(2, width - 3);
    let z = ROT.RNG.getUniformInt(2, height - 3);
    const steps = ROT.RNG.getUniformInt(2, 9);
    for (let s = 0; s < steps; s++) {
      cells[z * width + x] = 1;
      const dir = ROT.RNG.getUniformInt(0, 3);
      x = Math.min(width - 2, Math.max(1, x + (dir === 0 ? 1 : dir === 1 ? -1 : 0)));
      z = Math.min(height - 2, Math.max(1, z + (dir === 2 ? 1 : dir === 3 ? -1 : 0)));
    }
  }

  // Connectivity: keep only the largest floor region so A* and spawns can
  // never be stranded in a walled-off pocket; other pockets become solid.
  const floors = keepLargestRegion(cells, width, height);

  // The area reads west → east: enter at the west edge, leave at the east.
  // Both picked from the surviving region, so a walkable route always exists.
  const entry = nearestFloor(floors, 1, height / 2);
  const exit = nearestFloor(floors, width - 2, height / 2);

  const isWall = (x: number, z: number) => {
    if (x < 0 || z < 0 || x >= width || z >= height) return true;
    return cells[z * width + x] === 1;
  };

  return { width, height, cells, floors, entry, exit, isWall };
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
 *  cell — sampled every quarter-tile, plenty at our obstacle sizes. */
export function hasLineOfSight(
  map: GameMap,
  a: { x: number; z: number },
  b: { x: number; z: number },
): boolean {
  const dist = Math.hypot(b.x - a.x, b.z - a.z);
  const steps = Math.ceil(dist / (TILE * 0.25));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (map.isWall(worldToCell(a.x + (b.x - a.x) * t), worldToCell(a.z + (b.z - a.z) * t))) return false;
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
 * Move a collision circle by vel·dt with axis-separated clamping against
 * solid cells — sliding along obstacle faces falls out for free. Mutates
 * `pos`. No tunnel risk at our speeds (~0.1 u/frame vs TILE = 1); faster
 * movers would need substepping.
 */
export function moveCircle(
  map: GameMap,
  pos: { x: number; z: number },
  vel: { x: number; z: number },
  r: number,
  dt: number,
): void {
  // X axis
  let nx = pos.x + vel.x * dt;
  if (vel.x !== 0) {
    for (let cz = worldToCell(pos.z - r); cz <= worldToCell(pos.z + r); cz++) {
      // Skip cells the circle doesn't actually overlap in Z.
      const closestZ = Math.min(Math.max(pos.z, cellMin(cz)), cellMax(cz));
      if (Math.abs(pos.z - closestZ) >= r) continue;
      for (let cx = worldToCell(nx - r); cx <= worldToCell(nx + r); cx++) {
        if (!map.isWall(cx, cz)) continue;
        if (nx + r > cellMin(cx) && nx - r < cellMax(cx)) {
          nx = vel.x > 0 ? Math.min(nx, cellMin(cx) - r) : Math.max(nx, cellMax(cx) + r);
        }
      }
    }
  }
  pos.x = nx;

  // Z axis (against the updated X)
  let nz = pos.z + vel.z * dt;
  if (vel.z !== 0) {
    for (let cx = worldToCell(pos.x - r); cx <= worldToCell(pos.x + r); cx++) {
      const closestX = Math.min(Math.max(pos.x, cellMin(cx)), cellMax(cx));
      if (Math.abs(pos.x - closestX) >= r) continue;
      for (let cz = worldToCell(nz - r); cz <= worldToCell(nz + r); cz++) {
        if (!map.isWall(cx, cz)) continue;
        if (nz + r > cellMin(cz) && nz - r < cellMax(cz)) {
          nz = vel.z > 0 ? Math.min(nz, cellMin(cz) - r) : Math.max(nz, cellMax(cz) + r);
        }
      }
    }
  }
  pos.z = nz;
}

/** True if a circle at (x, z) overlaps any solid cell (projectile impacts). */
export function circleOverlapsWall(map: GameMap, x: number, z: number, r: number): boolean {
  for (let cz = worldToCell(z - r); cz <= worldToCell(z + r); cz++) {
    for (let cx = worldToCell(x - r); cx <= worldToCell(x + r); cx++) {
      if (!map.isWall(cx, cz)) continue;
      const dx = x - Math.min(Math.max(x, cellMin(cx)), cellMax(cx));
      const dz = z - Math.min(Math.max(z, cellMin(cz)), cellMax(cz));
      if (dx * dx + dz * dz < r * r) return true;
    }
  }
  return false;
}
