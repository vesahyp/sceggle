import * as ROT from 'rot-js';

export const TILE = 1; // world units per grid cell

/** Grid cell → world coordinate (cell centre). */
export const cellToWorld = (c: number) => c * TILE;

/** World coordinate → grid cell. */
export const worldToCell = (w: number) => Math.round(w / TILE);

export type Cell = 0 | 1; // 0 = floor, 1 = wall

export interface Dungeon {
  width: number;
  height: number;
  /** Row-major grid, indexed [z * width + x]. */
  cells: Uint8Array;
  /** Walkable floor cells, in generation order. */
  floors: Array<{ x: number; z: number }>;
  isWall: (x: number, z: number) => boolean;
}

/**
 * Generate a dungeon with rot.js's Digger (rooms joined by corridors), seeded
 * for reproducibility. Rendering and physics are separate concerns — this
 * module only produces the grid + the list of walkable cells. Swap Digger for
 * Uniform / Cellular / etc. without touching anything downstream.
 */
export function generateDungeon(width: number, height: number, seed?: number): Dungeon {
  if (seed !== undefined) ROT.RNG.setSeed(seed);

  const cells = new Uint8Array(width * height).fill(1); // start all walls
  const floors: Array<{ x: number; z: number }> = [];

  const digger = new ROT.Map.Digger(width, height, {
    dugPercentage: 0.28,
    roomWidth: [3, 8],
    roomHeight: [3, 7],
  });

  digger.create((x, z, wall) => {
    // rot.js: value 1 = wall, 0 = floor.
    if (!wall) {
      cells[z * width + x] = 0;
      floors.push({ x, z });
    }
  });

  const isWall = (x: number, z: number) => {
    if (x < 0 || z < 0 || x >= width || z >= height) return true;
    return cells[z * width + x] === 1;
  };

  return { width, height, cells, floors, isWall };
}
