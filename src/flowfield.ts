import type { GameMap } from './worldmap';

/**
 * A flow field: one Dijkstra expansion out from a goal cell, giving every
 * walkable cell on the map the direction of its next step toward that goal.
 *
 * This is the horde answer to "N mobs want to reach the same place". A
 * per-mob A* costs one search per mob per repath and returns a private,
 * 4-connected staircase — so a pack converges into a single file. One field
 * costs a single pass for the whole map and every mob just samples the cell
 * it stands in, for free, every frame.
 *
 * Costs are integers (`ORTHO`/`DIAG` ≈ 1 : √2 scaled by 10) so the field is
 * exact and reproducible — no floating-point tie-breaks, which matters for
 * the determinism rule. Nothing here draws RNG.
 */

/** Cost of an orthogonal step, ×10 to keep diagonals integral. */
const ORTHO = 10;
/** Cost of a diagonal step: √2 × 10, rounded. */
const DIAG = 14;
/** Cost stored in cells with no route to the goal (also walls). */
export const UNREACHABLE = 0xffff;

/** Neighbour offsets, orthogonals first. Fixed order = deterministic ties. */
const NX = [1, -1, 0, 0, 1, 1, -1, -1];
const NZ = [0, 0, 1, -1, 1, -1, 1, -1];
const NCOST = [ORTHO, ORTHO, ORTHO, ORTHO, DIAG, DIAG, DIAG, DIAG];

export interface FlowField {
  width: number;
  height: number;
  /** Cell this field flows toward. */
  goalX: number;
  goalZ: number;
  /** Travel cost from each cell to the goal, row-major; UNREACHABLE if none. */
  cost: Uint16Array;
  /** Unit direction toward the next cell downhill, row-major. Zero at the
   *  goal itself, in walls, and anywhere unreachable. */
  dirX: Float32Array;
  dirZ: Float32Array;
}

/** Scratch binary heap, reused across rebuilds so a repath allocates nothing. */
let heapCell = new Int32Array(0);
let heapCost = new Int32Array(0);
let heapSize = 0;

function heapPush(cell: number, cost: number): void {
  let i = heapSize++;
  heapCell[i] = cell;
  heapCost[i] = cost;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (heapCost[parent] <= heapCost[i]) break;
    swap(parent, i);
    i = parent;
  }
}

function heapPop(): number {
  const top = heapCell[0];
  heapSize--;
  if (heapSize > 0) {
    heapCell[0] = heapCell[heapSize];
    heapCost[0] = heapCost[heapSize];
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let small = i;
      if (l < heapSize && heapCost[l] < heapCost[small]) small = l;
      if (r < heapSize && heapCost[r] < heapCost[small]) small = r;
      if (small === i) break;
      swap(small, i);
      i = small;
    }
  }
  return top;
}

function swap(a: number, b: number): void {
  const c = heapCell[a];
  heapCell[a] = heapCell[b];
  heapCell[b] = c;
  const k = heapCost[a];
  heapCost[a] = heapCost[b];
  heapCost[b] = k;
}

/**
 * Build (or refill) the field rooted at a goal cell.
 *
 * Pass the previous field back as `into` to reuse its buffers — the sim
 * rebuilds whenever the player crosses a cell boundary, so this runs a few
 * times a second and should not churn the heap.
 *
 * Diagonal steps are only taken when BOTH adjoining orthogonals are open, so
 * the field never routes a mob through the corner gap between two rocks —
 * a gap `moveCircle` would refuse to let it walk through.
 */
export function buildFlowField(
  map: GameMap,
  goalX: number,
  goalZ: number,
  into?: FlowField,
): FlowField {
  const { width, height } = map;
  const n = width * height;

  const field: FlowField =
    into && into.width === width && into.height === height
      ? into
      : {
          width,
          height,
          goalX,
          goalZ,
          cost: new Uint16Array(n),
          dirX: new Float32Array(n),
          dirZ: new Float32Array(n),
        };
  field.goalX = goalX;
  field.goalZ = goalZ;
  field.cost.fill(UNREACHABLE);
  field.dirX.fill(0);
  field.dirZ.fill(0);

  if (heapCell.length < n) {
    heapCell = new Int32Array(n);
    heapCost = new Int32Array(n);
  }
  heapSize = 0;

  // A goal inside a wall (player clipped into a carved cell, say) has no
  // expansion to give — leave the field empty and let callers fall back.
  if (map.isWall(goalX, goalZ)) return field;

  field.cost[goalZ * width + goalX] = 0;
  heapPush(goalZ * width + goalX, 0);

  while (heapSize > 0) {
    const cell = heapPop();
    const cx = cell % width;
    const cz = (cell - cx) / width;
    const base = field.cost[cell];

    for (let i = 0; i < 8; i++) {
      const nx = cx + NX[i];
      const nz = cz + NZ[i];
      if (nx < 0 || nz < 0 || nx >= width || nz >= height) continue;
      if (map.isWall(nx, nz)) continue;
      // No corner-cutting: a diagonal needs both of its orthogonals open.
      if (i >= 4 && (map.isWall(cx + NX[i], cz) || map.isWall(cx, cz + NZ[i]))) continue;

      const next = base + NCOST[i];
      const ni = nz * width + nx;
      if (next >= field.cost[ni]) continue;
      field.cost[ni] = next;
      heapPush(ni, next);
    }
  }

  writeDirections(map, field);
  return field;
}

/**
 * Second pass: point each cell at its cheapest neighbour. Doing this after
 * the expansion (rather than recording the relaxing parent) means a cell
 * points downhill along the *best* of its eight neighbours, which keeps the
 * field smooth where several routes converge.
 */
function writeDirections(map: GameMap, field: FlowField): void {
  const { width, height, cost, dirX, dirZ } = field;
  for (let cz = 0; cz < height; cz++) {
    for (let cx = 0; cx < width; cx++) {
      const cell = cz * width + cx;
      const here = cost[cell];
      if (here === UNREACHABLE || here === 0) continue;

      let best = here;
      let bx = 0;
      let bz = 0;
      for (let i = 0; i < 8; i++) {
        const nx = cx + NX[i];
        const nz = cz + NZ[i];
        if (nx < 0 || nz < 0 || nx >= width || nz >= height) continue;
        if (i >= 4 && (map.isWall(cx + NX[i], cz) || map.isWall(cx, cz + NZ[i]))) continue;
        const c = cost[nz * width + nx];
        if (c >= best) continue;
        best = c;
        bx = NX[i];
        bz = NZ[i];
      }
      if (bx === 0 && bz === 0) continue;
      const len = Math.hypot(bx, bz);
      dirX[cell] = bx / len;
      dirZ[cell] = bz / len;
    }
  }
}

/**
 * Sample the field at a cell. Returns a zero vector when the cell is a wall,
 * unreachable, or is the goal itself — callers should fall back to steering
 * straight at the target in that case.
 */
export function flowAt(
  field: FlowField,
  cx: number,
  cz: number,
): { x: number; z: number; reachable: boolean } {
  if (cx < 0 || cz < 0 || cx >= field.width || cz >= field.height) {
    return { x: 0, z: 0, reachable: false };
  }
  const cell = cz * field.width + cx;
  return {
    x: field.dirX[cell],
    z: field.dirZ[cell],
    reachable: field.cost[cell] !== UNREACHABLE,
  };
}
