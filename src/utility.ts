/**
 * Utility scoring: what a mob WANTS to do this tick.
 *
 * Steering (steering.ts) answers "which way do I go to achieve that", and the
 * flow field answers "where is the target". This layer sits above both and
 * answers the question neither does: given how far away the target is, how
 * hurt I am and who else is nearby, is closing the right idea at all?
 *
 * Every candidate intent scores itself from the same world facts; highest
 * wins. That matters more than it sounds: adding a behaviour means adding a
 * scorer, not threading another branch through a movement function that
 * already has five. And because the scores are just numbers weighted by three
 * per-mob traits, archetypes fall out of the spawn roll instead of a
 * hardcoded roster — a high-aggression mob rushes, a cautious one skirmishes
 * and breaks off when hurt, a patient one circles wide and commits late, with
 * no code anywhere that knows what a "rusher" is.
 *
 * There is deliberately no "stand still and shoot" intent. Attacking is not a
 * movement commitment for either side (see ROADMAP's design direction) — a
 * mob that plants to swing is a mob you can't kite, which is the whole game.
 * Range archetypes come from `attackRange`, not from standing still.
 *
 * Pure arithmetic: no RNG, no ECS, no map. Deterministic by construction.
 */

/** What a mob is trying to do. */
export type Intent = 'close' | 'orbit' | 'retreat' | 'regroup';

export const INTENTS: readonly Intent[] = ['close', 'orbit', 'retreat', 'regroup'];

/**
 * The three dials a mob's behaviour hangs off, rolled at spawn as shares of
 * one budget so they always trade off against each other — no mob is
 * simultaneously reckless, careful and deliberate.
 */
export interface Traits {
  /** Closes harder, searches faster, less inclined to give ground. */
  aggression: number;
  /** Keeps a wider berth, breaks off when hurt, dislikes being alone. */
  caution: number;
  /** Circles wide and commits late rather than diving in. */
  patience: number;
}

/** What the sim observed about a mob's situation this tick. */
export interface Facts {
  /** Distance to the target as a multiple of the mob's preferred range:
   *  1 = exactly at its band, 2 = twice as far out. */
  range: number;
  /** Remaining health, 0..1. */
  health: number;
  /** Allies close enough to count as company. */
  allies: number;
  /** Does it hold one of the area's attack tokens? Without a turn there is
   *  nothing to be gained by crowding in, so it circles and waits. */
  hasToken: boolean;
}

/** How much a mob without a turn still wants to close. Not zero: it has to
 *  get near enough to be worth a token in the first place, or the queue
 *  deadlocks with everyone hanging back out of range. */
const WAIT_CLOSE = 0.45;
/** How much more a mob without a turn wants to circle. Waiting should look
 *  like prowling, not like standing in line. */
const WAIT_ORBIT = 1.35;

/** How wide the "at my range" bell is, in multiples of the preferred range. */
const BAND_WIDTH = 0.85;
/** Allies needed before a mob stops feeling isolated. */
const REGROUP_ALLIES = 3;
/** Score bonus for whatever the mob is already doing. Utility AI flip-flops
 *  between near-tied intents without it, which reads as twitching. */
const HYSTERESIS = 0.12;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** 1 at the preferred range, falling to 0 either side of it. */
const atBand = (range: number) => clamp01(1 - Math.abs(range - 1) / BAND_WIDTH);

/**
 * Score one intent. Kept as a single switch rather than five functions so the
 * whole behavioural model is readable in one screen — this is the file you
 * come to when a mob is doing something odd.
 */
export function score(intent: Intent, t: Traits, f: Facts, standoffInner: number): number {
  switch (intent) {
    // Anything outside its band wants to close; aggression sets how hard.
    // The floor matters: a mob with no aggression at all still has to engage,
    // or it stands at range forever and the fight never happens.
    case 'close':
      return clamp01(f.range - 1) * (0.5 + t.aggression) * (f.hasToken ? 1 : WAIT_CLOSE);

    // Circling is what you do once you have arrived. Patient mobs prefer it
    // to committing, but everyone does it a bit — standing still in a horde
    // shooter reads as broken.
    case 'orbit':
      return atBand(f.range) * (0.25 + t.patience * 0.7) * (f.hasToken ? 1 : WAIT_ORBIT);

    // Two reasons to give ground: shoved inside the band (everyone), or hurt
    // and careful about it (the skirmisher's exit).
    case 'retreat':
      return Math.max(
        clamp01((standoffInner - f.range) / standoffInner),
        t.caution * (1 - f.health),
      );

    // Alone, careful, and not yet committed — go find the pack first.
    case 'regroup':
      return (
        t.caution * clamp01(1 - f.allies / REGROUP_ALLIES) * clamp01(f.range - 1) * 0.8
      );
  }
}

/**
 * Pick the highest-scoring intent, with a thumb on the scale for whatever the
 * mob is already doing. Ties break toward the earlier entry in INTENTS, which
 * keeps the choice deterministic.
 */
export function chooseIntent(
  t: Traits,
  f: Facts,
  standoffInner: number,
  current: Intent | undefined,
): Intent {
  let best: Intent = 'close';
  let bestScore = -Infinity;
  for (const intent of INTENTS) {
    const s = score(intent, t, f, standoffInner) + (intent === current ? HYSTERESIS : 0);
    if (s > bestScore) {
      bestScore = s;
      best = intent;
    }
  }
  return best;
}

/**
 * How an intent moves: a radial pull (toward the target, away from it, or
 * neither) and how strongly to circle while doing it. Steering turns this
 * into an actual heading once terrain and bodies have had their say.
 */
export interface Drive {
  /** +1 close, -1 give ground, 0 hold station. */
  radial: number;
  /** Weight of the orbit desire relative to the radial one. */
  lateral: number;
  /** Head for the allies' centroid instead of the target. */
  toAllies?: boolean;
}

export function driveFor(intent: Intent, t: Traits): Drive {
  switch (intent) {
    case 'close':
      // A little circling on the way in is what makes a pack arrive as an
      // arc instead of a column.
      return { radial: 1, lateral: 0.2 + t.patience * 0.5 };
    case 'orbit':
      return { radial: 0, lateral: 1 };
    case 'retreat':
      return { radial: -1, lateral: 0.3 + t.patience * 0.4 };
    case 'regroup':
      return { radial: 1, lateral: 0, toAllies: true };
  }
}

/**
 * The fraction of its preferred range a mob defends. Cautious mobs start
 * giving ground earlier, so "how close will it let you get" is a rolled stat
 * rather than one constant for the whole horde.
 */
export function standoffInner(t: Traits): number {
  return 0.62 + t.caution * 0.25;
}

/** Speed multiplier while advancing on a remembered position — aggressive
 *  mobs push in, careful ones creep. */
export function searchPace(t: Traits): number {
  return 0.5 + t.aggression * 0.4;
}

/** Multiplier on how long a mob pokes around before giving up. */
export function searchPersistence(t: Traits): number {
  return 0.6 + t.patience;
}
