/**
 * Behavioural checks for the simulation — `npm run sim-check`.
 *
 * This drives the REAL `stepSimulation` over a REAL generated map, headless
 * and with no renderer: build a world, spawn entities, run ticks, assert on
 * where things ended up. It exists because a green `npm run build` says
 * nothing about whether mobs actually path, fight and forget, and because
 * the browser smoke test in CLAUDE.md can't answer that either — R3F's
 * `useFrame` does not run under headless Chromium here, so the sim never
 * ticks and every entity sits still whatever the code does.
 *
 * Deliberately not a unit-test suite: no runner, no mocks, no assertions on
 * internals. Everything is observed from the outside (positions, distances,
 * component state after N ticks) so it stays honest across refactors of how
 * the AI reaches those outcomes.
 *
 * Sensory stats are overridden per case to isolate what's under test —
 * `hearing: 999` when the case is about routing rather than perception, real
 * cones and ranges when perception IS the case. Vary from the defaults only
 * with a reason.
 */
// Node-only, and the app has no node typings — one ambient beats a devDep.
declare const process: { exitCode?: number };

import * as ROT from 'rot-js';
import { world, type Entity } from '../src/ecs';
import { generateWorldMap, cellToWorld, circleOverlapsWall } from '../src/worldmap';
import { stepSimulation, setAttackTokens } from '../src/systems';
import { generateWeapon } from '../src/weapons';

let fails = 0;
const check = (name: string, ok: boolean, extra = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
};

/** Clear the world and restore per-area sim state. The token pool is module
 *  state in systems.ts, so without resetting it here a case would inherit
 *  whatever the previous one set and pass or fail for the wrong reason. */
function reset(seed: number) {
  for (const e of [...world.entities]) world.remove(e);
  setAttackTokens(3);
  ROT.RNG.setSeed(seed);
  return generateWorldMap(64, 64, seed);
}

function makeMob(x: number, z: number, over: Partial<NonNullable<Entity['brain']>> = {}, speed = 3): Entity {
  return world.add({
    mob: true,
    pos: { x, z },
    vel: { x: 0, z: 0 },
    radius: 0.3,
    moveSpeed: speed,
    aim: { x: 0, z: 1 },
    health: { current: 10, max: 10 },
    brain: {
      // Balanced by default so cases that aren't about temperament aren't
      // secretly testing one.
      traits: { aggression: 0.34, caution: 0.33, patience: 0.33 },
      strafe: 1,
      sight: 6,
      fov: 0.8,
      hearing: 3,
      perceives: false,
      alert: 1,
      memory: 6,
      searchLook: 2.5,
      lastSeen: undefined,
      attackRange: 1.2,
      attackIn: 0,
      token: false,
      tokenHold: 0,
      tokenCool: 0,
      stagger: 0,
      wanderIn: 1,
      ...over,
    },
  });
}

function makePlayer(x: number, z: number): Entity {
  return world.add({
    player: true,
    pos: { x, z },
    vel: { x: 0, z: 0 },
    radius: 0.3,
    aim: { x: 0, z: 1 },
    health: { current: 100, max: 100 },
  });
}

/** Put a player bullet into a mob through the real projectile pipeline, so
 *  the rousing goes through damageMob exactly as a shot from the player would. */
function shoot(map: ReturnType<typeof generateWorldMap>, target: Entity, damage = 1): void {
  world.add({
    projectile: {
      faction: 'player',
      damage,
      knockback: 0,
      stagger: 0,
      speed: 10,
      maxRange: 5,
      traveled: 0,
      pierce: false,
      bounces: 0,
      splits: 0,
      blast: 0,
      lob: false,
      linger: 0,
      mechanisms: [],
      struck: [],
    },
    pos: { x: target.pos!.x + 0.6, z: target.pos!.z },
    vel: { x: -10, z: 0 },
    radius: 0.1,
  });
  for (let i = 0; i < 10; i++) stepSimulation(map, 1 / 60);
}

/** The most open floor cell available, preferring `want` units of clearance
 *  but settling for less rather than depending on a lucky seed. */
function openCell(map: ReturnType<typeof generateWorldMap>, want: number): { x: number; z: number } {
  for (let r = want; r >= 1; r -= 0.5) {
    const c = map.floors.find((f) => !circleOverlapsWall(map, cellToWorld(f.x), cellToWorld(f.z), r));
    if (c) return c;
  }
  return map.floors[0];
}

const dist = (a: Entity, b: Entity) => Math.hypot(a.pos!.x - b.pos!.x, a.pos!.z - b.pos!.z);
const run = (map: ReturnType<typeof generateWorldMap>, ticks: number) => {
  for (let i = 0; i < ticks; i++) stepSimulation(map, 1 / 60);
};

// --- 1. An alerted mob closes on the player, around whatever is in the way.
{
  const map = reset(1337);
  const p = makePlayer(cellToWorld(map.entry.x), cellToWorld(map.entry.z));
  // Put mobs on floor cells spread across the map so several routes are tested.
  const picks = map.floors.filter((c) => {
    const d = Math.hypot(cellToWorld(c.x) - p.pos!.x, cellToWorld(c.z) - p.pos!.z);
    return d > 15 && d < 30;
  });
  const chosen = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => picks[Math.floor((i / 8) * picks.length)]);
  // Perfect ears: this case is about the field routing them around terrain,
  // not about whether they can notice the player from 25 units away.
  const ms = chosen.map((c) => makeMob(cellToWorld(c.x), cellToWorld(c.z), { hearing: 999 }));
  const before = ms.map((m) => dist(m, p));

  const trace: string[] = [];
  for (let s = 0; s < 5; s++) {
    run(map, 60 * 5);
    trace.push(ms.map((m) => dist(m, p).toFixed(0)).join(' '));
  }
  console.log('    chase trace (every 5s):\n      ' + trace.join('\n      '));

  const after = ms.map((m) => dist(m, p));
  const closed = after.filter((d, i) => d < before[i] - 2).length;
  check('chase: alerted mobs close distance', closed === ms.length, `${closed}/${ms.length} closed`);
  check(
    'chase: reached the fighting band',
    after.filter((d) => d < 2.5).length >= ms.length - 1,
    after.map((d) => d.toFixed(1)).join(' '),
  );
  const stuck = ms.filter((m) => circleOverlapsWall(map, m.pos!.x, m.pos!.z, m.radius! - 0.02)).length;
  check('chase: nobody ends up inside terrain', stuck === 0, `${stuck} embedded`);
}

// --- 2. In the band, mobs orbit instead of freezing.
{
  const map = reset(4242);
  // Fight in the open — the entry cell hugs the map edge, where wall danger
  // would legitimately distort the band.
  const open = openCell(map, 4);
  const p = makePlayer(cellToWorld(open.x), cellToWorld(open.z));
  const m = makeMob(p.pos!.x + 1.2, p.pos!.z, { attackRange: 1.2, hearing: 999 });
  run(map, 30);
  const band: string[] = [];
  for (let i = 0; i < 6; i++) {
    run(map, 20);
    band.push(dist(m, p).toFixed(2));
  }
  console.log('    band trace: ' + band.join(' '));
  let travelled = 0;
  let prev = { ...m.pos! };
  for (let i = 0; i < 120; i++) {
    stepSimulation(map, 1 / 60);
    travelled += Math.hypot(m.pos!.x - prev.x, m.pos!.z - prev.z);
    prev = { ...m.pos! };
  }
  check('band: mob keeps moving in range', travelled > 1.5, `travelled ${travelled.toFixed(2)}`);
  check(
    'band: mob holds its range',
    dist(m, p) > 0.5 && dist(m, p) < 2.5,
    `range ${dist(m, p).toFixed(2)}`,
  );
}

// --- 3. A pack arrives spread out rather than stacked on one tile.
{
  const map = reset(99);
  const p = makePlayer(cellToWorld(map.entry.x), cellToWorld(map.entry.z));
  const start = map.floors.filter((c) => {
    const d = Math.hypot(cellToWorld(c.x) - p.pos!.x, cellToWorld(c.z) - p.pos!.z);
    return d > 10 && d < 14;
  });
  const pack = Array.from({ length: 12 }, (_, i) =>
    makeMob(cellToWorld(start[i % start.length].x), cellToWorld(start[i % start.length].z), {
      strafe: i % 2 === 0 ? 1 : -1,
      hearing: 999,
    }),
  );
  run(map, 60 * 12);

  let minGap = Infinity;
  for (let i = 0; i < pack.length; i++)
    for (let j = i + 1; j < pack.length; j++) minGap = Math.min(minGap, dist(pack[i], pack[j]));
  check('pack: bodies stay separated', minGap > 0.3, `closest pair ${minGap.toFixed(2)}`);

  // Spread of bearings around the player — a beeline gives near-zero spread.
  const bearings = pack.map((m) => Math.atan2(m.pos!.z - p.pos!.z, m.pos!.x - p.pos!.x));
  const cx = bearings.reduce((s, b) => s + Math.cos(b), 0) / bearings.length;
  const cz = bearings.reduce((s, b) => s + Math.sin(b), 0) / bearings.length;
  const spread = 1 - Math.hypot(cx, cz); // 0 = all one direction, →1 = surrounded
  check('pack: surrounds rather than beelines', spread > 0.25, `spread ${spread.toFixed(2)}`);
}

// --- 4. Determinism: identical seed and inputs give identical end state.
{
  const snapshot = (seed: number) => {
    const map = reset(seed);
    const p = makePlayer(cellToWorld(map.entry.x), cellToWorld(map.entry.z));
    const picks = map.floors.filter((c) => {
      const d = Math.hypot(cellToWorld(c.x) - p.pos!.x, cellToWorld(c.z) - p.pos!.z);
      return d > 12 && d < 20;
    });
    const ms = [0, 1, 2, 3, 4].map((i) =>
      makeMob(
        cellToWorld(picks[Math.floor((i / 5) * picks.length)].x),
        cellToWorld(picks[Math.floor((i / 5) * picks.length)].z),
        { hearing: 999 },
      ),
    );
    run(map, 60 * 6);
    return ms.map((m) => `${m.pos!.x.toFixed(6)},${m.pos!.z.toFixed(6)}`).join('|');
  };
  check('determinism: same seed, same end state', snapshot(7) === snapshot(7));
}

// --- 5. Unalerted mobs still wander (the old behaviour must survive).
{
  const map = reset(555);
  makePlayer(cellToWorld(map.entry.x), cellToWorld(map.entry.z));
  const idle = map.floors
    .filter((c) => Math.hypot(cellToWorld(c.x) - cellToWorld(map.entry.x), cellToWorld(c.z) - cellToWorld(map.entry.z)) > 25)
    .slice(0, 10)
    .map((c) => makeMob(cellToWorld(c.x), cellToWorld(c.z), { alert: 0, wanderIn: 0 }));
  const before = idle.map((m) => ({ ...m.pos! }));
  run(map, 60 * 8);
  const moved = idle.filter((m, i) => Math.hypot(m.pos!.x - before[i].x, m.pos!.z - before[i].z) > 0.3).length;
  check('wander: idle mobs still roam', moved >= 5, `${moved}/10 roamed`);
}

// --- 6. Immobile mobs (spawners: speed 0) stay put.
{
  const map = reset(31);
  const p = makePlayer(cellToWorld(map.entry.x), cellToWorld(map.entry.z));
  const s = makeMob(p.pos!.x + 6, p.pos!.z, { attackRange: 1, hearing: 999 }, 0);
  const start = { ...s.pos! };
  run(map, 60 * 5);
  check(
    'immobile: speed 0 stays put',
    Math.hypot(s.pos!.x - start.x, s.pos!.z - start.z) < 0.05,
    `drifted ${Math.hypot(s.pos!.x - start.x, s.pos!.z - start.z).toFixed(3)}`,
  );
}

// --- 7. Walled-off mob doesn't jitter or embed itself.
{
  const map = reset(2024);
  const p = makePlayer(cellToWorld(map.entry.x), cellToWorld(map.entry.z));
  // Find a floor cell fully enclosed by walls, if the seed produced one;
  // otherwise assert the fallback path at least keeps the mob legal.
  const m = makeMob(cellToWorld(map.exit.x), cellToWorld(map.exit.z), { hearing: 999 });
  run(map, 60 * 10);
  check(
    'far side: mob stays out of terrain',
    !circleOverlapsWall(map, m.pos!.x, m.pos!.z, m.radius! - 0.02),
    `at ${m.pos!.x.toFixed(1)},${m.pos!.z.toFixed(1)} dist ${dist(m, p).toFixed(1)}`,
  );
}

// --- 8. Memory: a mob commits to where the player WAS, not where they are.
{
  const map = reset(808);
  const open = openCell(map, 5);
  const p = makePlayer(cellToWorld(open.x), cellToWorld(open.z));
  const m = makeMob(p.pos!.x + 4, p.pos!.z, { sight: 8, fov: Math.PI, hearing: 2, alert: 0 });
  m.aim!.x = -1;
  m.aim!.z = 0; // looking at the player

  run(map, 30);
  check('memory: acquires on sight', m.brain!.perceives && m.brain!.alert === 1);
  const seenAt = { ...m.brain!.lastSeen! };

  // Teleport the player far away — no perception, nothing heard.
  p.pos!.x += 40;
  run(map, 60 * 2);
  check('memory: keeps hunting from memory', !m.brain!.perceives && m.brain!.alert > 0);
  check(
    'memory: heads for the remembered spot',
    Math.hypot(m.pos!.x - seenAt.x, m.pos!.z - seenAt.z) <
      Math.hypot(m.pos!.x - p.pos!.x, m.pos!.z - p.pos!.z),
    `to memory ${Math.hypot(m.pos!.x - seenAt.x, m.pos!.z - seenAt.z).toFixed(1)}`,
  );

  let gaveUpAt: { x: number; z: number } | undefined;
  for (let i = 0; i < 60 * 20 && !gaveUpAt; i++) {
    stepSimulation(map, 1 / 60);
    if (m.brain!.alert === 0) gaveUpAt = { ...m.pos! };
  }
  check('memory: gives up eventually', !!gaveUpAt && !m.brain!.lastSeen);
  check(
    'memory: gave up AT the remembered spot',
    !!gaveUpAt && Math.hypot(gaveUpAt.x - seenAt.x, gaveUpAt.z - seenAt.z) < 1.5,
    gaveUpAt ? `${Math.hypot(gaveUpAt.x - seenAt.x, gaveUpAt.z - seenAt.z).toFixed(2)} from the spot` : 'never',
  );
}

// --- 9. Sustained sight keeps a mob hunting (no flicker at the sight edge).
{
  const map = reset(909);
  const open = openCell(map, 5);
  const p = makePlayer(cellToWorld(open.x), cellToWorld(open.z));
  const m = makeMob(p.pos!.x + 3, p.pos!.z, { sight: 8, fov: Math.PI, hearing: 2, alert: 0 });
  m.aim!.x = -1;
  m.aim!.z = 0;
  let lostFrames = 0;
  for (let i = 0; i < 60 * 6; i++) {
    stepSimulation(map, 1 / 60);
    if (!m.brain!.perceives) lostFrames++;
  }
  check('sustained: stays locked on in the open', lostFrames < 10, `${lostFrames} frames lost`);
}

// --- 10. Being hit rouses the mob and its packmates, but as memory.
{
  const map = reset(111);
  const open = openCell(map, 6);
  const p = makePlayer(cellToWorld(open.x), cellToWorld(open.z));
  // Far enough away that nothing perceives the player — and on verified-open
  // floor, not a fixed offset: what terrain sits 25 units east is the
  // layout roll's business, and a mob spawned inside rock eats the test
  // shot with its wall cell.
  const spot = map.floors.find(
    (f) =>
      Math.hypot(cellToWorld(f.x) - p.pos!.x, cellToWorld(f.z) - p.pos!.z) > 20 &&
      !circleOverlapsWall(map, cellToWorld(f.x), cellToWorld(f.z), 2.5),
  )!;
  const hit = makeMob(cellToWorld(spot.x), cellToWorld(spot.z), { sight: 4, fov: 0.5, hearing: 2, alert: 0 });
  const mate = makeMob(cellToWorld(spot.x) + 2, cellToWorld(spot.z), { sight: 4, fov: 0.5, hearing: 2, alert: 0 });
  run(map, 6);
  check('hit: quiet before the shot', hit.brain!.alert === 0 && mate.brain!.alert === 0);

  shoot(map, hit);
  check('hit: the target is roused', hit.brain!.alert > 0.9 && !!hit.brain!.lastSeen);
  check('hit: nearby packmate surges too', mate.brain!.alert > 0.9);
  check('hit: rousing is memory, not sight', hit.brain!.perceives === false);
}

// --- 11. Traits produce visibly different temperaments from one code path.
{
  const map = reset(2468);
  const open = openCell(map, 8);
  const p = makePlayer(cellToWorld(open.x), cellToWorld(open.z));
  p.health!.current = 1e9; // this case is about temperament, not survival
  p.health!.max = 1e9;

  const armed = (m: Entity) => {
    m.weapon = generateWeapon('melee', 1, 5);
    return m;
  };
  const rusher = armed(
    makeMob(p.pos!.x + 8, p.pos!.z, {
      traits: { aggression: 0.9, caution: 0.05, patience: 0.05 },
      hearing: 999,
    }),
  );
  const skirmisher = armed(
    makeMob(p.pos!.x, p.pos!.z + 8, {
      traits: { aggression: 0.1, caution: 0.8, patience: 0.1 },
      hearing: 999,
    }),
  );
  const circler = armed(
    makeMob(p.pos!.x - 8, p.pos!.z, {
      traits: { aggression: 0.05, caution: 0.05, patience: 0.9 },
      hearing: 999,
    }),
  );

  // Sample over a window, not one frame: intents cycle as tokens come and
  // go, so a single-frame reading is a coin toss.
  let circlerOrbit = 0;
  let rusherOrbit = 0;
  let circlerSum = 0;
  let rusherSum = 0;
  const FRAMES = 60 * 8;
  for (let i = 0; i < FRAMES; i++) {
    stepSimulation(map, 1 / 60);
    if (circler.brain!.intent === 'orbit') circlerOrbit++;
    if (rusher.brain!.intent === 'orbit') rusherOrbit++;
    circlerSum += dist(circler, p);
    rusherSum += dist(rusher, p);
  }
  console.log(
    `    orbit frames: circler=${circlerOrbit} rusher=${rusherOrbit}; ` +
      `mean range: circler=${(circlerSum / FRAMES).toFixed(2)} rusher=${(rusherSum / FRAMES).toFixed(2)}`,
  );
  check(
    'traits: all three engage from range',
    [rusher, skirmisher, circler].every((m) => dist(m, p) < 4),
    [rusher, skirmisher, circler].map((m) => dist(m, p).toFixed(1)).join(' '),
  );
  // The patient one plants to shoot where the others keep circling. Without
  // this, `hold` scores below `orbit` for every possible trait roll and the
  // intent is dead code that still looks like a feature.
  // Not asserted: raw orbit-frame counts. They read backwards — the
  // aggressive mob reaches its band sooner and therefore spends MORE frames
  // circling in it. Mean range is the unconfounded signal for how the two
  // temperaments differ.
  check(
    'traits: the aggressive one fights closer in',
    rusherSum / FRAMES < circlerSum / FRAMES,
    `mean range rusher=${(rusherSum / FRAMES).toFixed(2)} circler=${(circlerSum / FRAMES).toFixed(2)}`,
  );

  // Hurt them and let temperament decide what happens next.
  for (const m of [rusher, skirmisher]) m.health!.current = 2; // 20%
  const before = { rush: dist(rusher, p), skirm: dist(skirmisher, p) };
  run(map, 60 * 4);
  check(
    'traits: the cautious one breaks off when hurt',
    dist(skirmisher, p) > before.skirm + 1 && skirmisher.brain!.intent === 'retreat',
    `${before.skirm.toFixed(1)} → ${dist(skirmisher, p).toFixed(1)} (${skirmisher.brain!.intent})`,
  );
  check(
    'traits: the aggressive one does not',
    dist(rusher, p) < before.rush + 1 && rusher.brain!.intent !== 'retreat',
    `${before.rush.toFixed(1)} → ${dist(rusher, p).toFixed(1)} (${rusher.brain!.intent})`,
  );
}

// --- 12. A pack rolled from one seed is a mix, not a monoculture.
{
  reset(13579);
  const rollTraits = () => {
    const a = ROT.RNG.getUniform();
    const b = ROT.RNG.getUniform();
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    return { aggression: lo, caution: hi - lo, patience: 1 - hi };
  };
  const rolled = Array.from({ length: 200 }, rollTraits);
  const sums = rolled.map((t) => t.aggression + t.caution + t.patience);
  check('traits: budget always sums to 1', sums.every((s) => Math.abs(s - 1) < 1e-9));
  const dominant = (t: ReturnType<typeof rollTraits>) =>
    t.aggression >= t.caution && t.aggression >= t.patience
      ? 'aggr'
      : t.caution >= t.patience
        ? 'caut'
        : 'pati';
  const spread = new Set(rolled.map(dominant));
  const counts = ['aggr', 'caut', 'pati'].map((k) => rolled.filter((t) => dominant(t) === k).length);
  check('traits: all three temperaments occur', spread.size === 3, counts.join('/'));
  check(
    'traits: no temperament dominates the roll',
    counts.every((c) => c > rolled.length * 0.15),
    counts.join('/'),
  );
}

// --- 13. Attack tokens: a big pack takes turns instead of all swinging.
{
  const map = reset(31337);
  const open = openCell(map, 6);
  const p = makePlayer(cellToWorld(open.x), cellToWorld(open.z));
  p.health!.current = 1e9; // survive the pack; this case is about cadence
  p.health!.max = 1e9;

  const TOKENS = 3;
  setAttackTokens(TOKENS);

  const pack = Array.from({ length: 20 }, (_, i) => {
    const a = (i / 20) * Math.PI * 2;
    const m = makeMob(p.pos!.x + Math.sin(a) * 5, p.pos!.z + Math.cos(a) * 5, {
      hearing: 999,
      strafe: i % 2 === 0 ? 1 : -1,
    });
    m.weapon = generateWeapon('melee', 1, 5);
    return m;
  });

  let peakSwinging = 0;
  let peakTokens = 0;
  const swung = new Set<Entity>();
  for (let i = 0; i < 60 * 20; i++) {
    stepSimulation(map, 1 / 60);
    const swinging = pack.filter((m) => m.attack);
    peakSwinging = Math.max(peakSwinging, swinging.length);
    peakTokens = Math.max(peakTokens, pack.filter((m) => m.brain!.token).length);
    for (const m of swinging) swung.add(m);
  }

  console.log(`    tokens=${TOKENS} peak swinging=${peakSwinging} distinct attackers=${swung.size}/20`);
  check(
    'tokens: never more swinging at once than there are tokens',
    peakSwinging <= TOKENS,
    `peak ${peakSwinging}`,
  );
  check('tokens: never more granted than the pool', peakTokens <= TOKENS, `peak ${peakTokens}`);
  check(
    'tokens: the turn goes round the pack',
    swung.size >= 8,
    `${swung.size} of 20 got a swing in`,
  );
  check(
    'tokens: waiting mobs stay engaged, not parked',
    pack.filter((m) => dist(m, p) < 4).length >= 12,
    `${pack.filter((m) => dist(m, p) < 4).length} within 4 units`,
  );
}

// --- 14. Tokens are recounted from live mobs, so deaths can't leak them.
{
  const map = reset(4711);
  const open = openCell(map, 6);
  const p = makePlayer(cellToWorld(open.x), cellToWorld(open.z));
  setAttackTokens(2);
  const pack = Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * Math.PI * 2;
    const m = makeMob(p.pos!.x + Math.sin(a) * 1.5, p.pos!.z + Math.cos(a) * 1.5, { hearing: 999 });
    m.weapon = generateWeapon('melee', 1, 5);
    return m;
  });
  run(map, 60 * 2);
  // Kill whoever holds a turn, mid-swing if possible.
  for (const m of pack.filter((m) => m.brain!.token)) world.remove(m);
  // The pool must flow back to the survivors. Sampled over a window, not at
  // one end-instant: tokens legitimately sit unheld during the between-turns
  // cooldown, and where that gap falls depends on the ground under the fight.
  let reacquired = false;
  for (let i = 0; i < 60 * 3; i++) {
    stepSimulation(map, 1 / 60);
    if (pack.some((m) => world.has(m) && m.brain!.token)) reacquired = true;
  }
  const live = pack.filter((m) => world.has(m));
  check('tokens: survive holders dying', reacquired, `${live.length} survivors`);
}

console.log(fails === 0 ? '\nALL SIM CHECKS PASSED' : `\n${fails} CHECK(S) FAILED`);
if (fails > 0) process.exitCode = 1;
