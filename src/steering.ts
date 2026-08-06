import { circleOverlapsWall, type GameMap } from './worldmap';

/**
 * Context steering: instead of a chain of behaviours each overwriting the
 * velocity, every desire *votes* on a fixed ring of candidate directions.
 * Two maps are filled per mob per tick — `interest` (where it wants to go)
 * and `danger` (where it must not) — then resolved into one direction.
 *
 * The point is that desires compose without knowing about each other. A mob
 * can want to close distance, orbit its target, avoid a rock and avoid its
 * neighbours all at once, and the blend falls out of the arithmetic rather
 * than a priority ladder that has to be re-tuned every time a desire is
 * added. See ROADMAP: the utility pass replaces the *weights* fed in here,
 * not this machinery.
 *
 * Nothing here draws RNG or touches the ECS — it is pure scoring over
 * numbers, so it stays deterministic and testable.
 */

/** Candidate directions scored per tick. 16 keeps the ring smooth enough
 *  that the resolved vector doesn't visibly snap as a mob turns. */
export const SLOT_COUNT = 16;

const SLOT_X = new Float32Array(SLOT_COUNT);
const SLOT_Z = new Float32Array(SLOT_COUNT);
for (let i = 0; i < SLOT_COUNT; i++) {
  const a = (i / SLOT_COUNT) * Math.PI * 2;
  SLOT_X[i] = Math.cos(a);
  SLOT_Z[i] = Math.sin(a);
}

/** Danger falls off sharply: a blocked direction should veto its own slot and
 *  bleed into its immediate neighbours, not shut down the whole hemisphere. */
const DANGER_SHARPNESS = 4;
/** Slots within this much of the least-dangerous slot stay in the running.
 *  Slack matters — an exact-minimum filter leaves a single slot alive and the
 *  movement snaps between ring directions. */
const DANGER_SLACK = 0.08;

export interface Steering {
  interest: Float32Array;
  danger: Float32Array;
}

export function createSteering(): Steering {
  return { interest: new Float32Array(SLOT_COUNT), danger: new Float32Array(SLOT_COUNT) };
}

export function resetSteering(s: Steering): void {
  s.interest.fill(0);
  s.danger.fill(0);
}

/**
 * Vote for heading roughly along (dx, dz) — a wide cosine lobe, so the
 * neighbouring slots get partial credit and the resolve can interpolate
 * between them. The vector need not be normalized.
 */
export function addInterest(s: Steering, dx: number, dz: number, weight: number): void {
  if (weight <= 0) return;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return;
  const ux = dx / len;
  const uz = dz / len;
  for (let i = 0; i < SLOT_COUNT; i++) {
    const dot = SLOT_X[i] * ux + SLOT_Z[i] * uz;
    if (dot > 0) s.interest[i] += weight * dot;
  }
}

/** Vote against heading along (dx, dz), on the narrow lobe. */
export function addDanger(s: Steering, dx: number, dz: number, weight: number): void {
  if (weight <= 0) return;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return;
  const ux = dx / len;
  const uz = dz / len;
  for (let i = 0; i < SLOT_COUNT; i++) {
    const dot = SLOT_X[i] * ux + SLOT_Z[i] * uz;
    if (dot > 0) s.danger[i] += weight * dot ** DANGER_SHARPNESS;
  }
}

/**
 * Mark directions that would walk the body into terrain, by probing each
 * ring slot `lookahead` units out. This is what stops a mob grinding along
 * a rock face: the blocked arc is vetoed, so the chase interest resolves
 * onto the nearest open slot and the mob slides around the obstacle.
 *
 * Gated on there being any wall within reach at all, so mobs in the open —
 * most of them, most of the time — pay one cheap test instead of sixteen.
 */
export function addWallDanger(
  s: Steering,
  map: GameMap,
  x: number,
  z: number,
  radius: number,
  lookahead: number,
  weight: number,
): void {
  if (!circleOverlapsWall(map, x, z, radius + lookahead)) return;
  for (let i = 0; i < SLOT_COUNT; i++) {
    if (circleOverlapsWall(map, x + SLOT_X[i] * lookahead, z + SLOT_Z[i] * lookahead, radius)) {
      s.danger[i] += weight;
    }
  }
}

/**
 * Collapse the two maps into one direction: discard every slot meaningfully
 * more dangerous than the safest one, take the most interesting slot that
 * survives, and blend it with its two immediate neighbours so the heading
 * moves continuously rather than snapping between ring directions.
 *
 * Blending only with *neighbours* is the important part. Summing every
 * surviving slot instead looks tempting but averages across the gap: with a
 * wall dead ahead, the open arcs either side cancel into the blocked
 * direction and the mob walks straight into it.
 *
 * When every slot with interest is masked off, the mob still needs somewhere
 * to go — fall back to the safest direction available rather than freezing.
 *
 * Returns a unit vector, or zero only when no desire was expressed at all.
 */
export function resolveSteering(s: Steering): { x: number; z: number } {
  let minDanger = Infinity;
  let safest = 0;
  for (let i = 0; i < SLOT_COUNT; i++) {
    if (s.danger[i] < minDanger) {
      minDanger = s.danger[i];
      safest = i;
    }
  }
  const cutoff = minDanger + DANGER_SLACK;

  let best = -1;
  let bestInterest = 0;
  let anyInterest = false;
  for (let i = 0; i < SLOT_COUNT; i++) {
    if (s.interest[i] > 0) anyInterest = true;
    if (s.danger[i] > cutoff) continue;
    if (s.interest[i] > bestInterest) {
      bestInterest = s.interest[i];
      best = i;
    }
  }

  if (!anyInterest) return { x: 0, z: 0 };
  // Wanted to go somewhere, but every such heading is blocked — take the
  // least-bad direction so the mob keeps moving and re-evaluates next tick.
  if (best < 0) return { x: SLOT_X[safest], z: SLOT_Z[safest] };

  let x = SLOT_X[best] * bestInterest;
  let z = SLOT_Z[best] * bestInterest;
  for (const step of [-1, 1]) {
    const i = (best + step + SLOT_COUNT) % SLOT_COUNT;
    if (s.danger[i] > cutoff) continue;
    const w = s.interest[i];
    if (w <= 0) continue;
    x += SLOT_X[i] * w;
    z += SLOT_Z[i] * w;
  }

  const len = Math.hypot(x, z);
  if (len < 1e-6) return { x: 0, z: 0 };
  return { x: x / len, z: z / len };
}
