import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrthographicCamera } from '@react-three/drei';
import * as ROT from 'rot-js';
import { world, type Entity } from './ecs';
import {
  generateMechanism,
  generateWeapon,
  weaponBudget,
  type MechanismDef,
  type WeaponDef,
} from './weapons';
import { characterHp, characterResist, characterSpeed, rollStarterWeapon, type CharacterDef } from './characters';
import { GameMenu, type GameMenuTab } from './Menu';
import { Inventory } from './Inventory';
import { TouchSticks } from './TouchSticks';
import { initTouch } from './touch';
import {
  generateWorldMap,
  cellToWorld,
  KIND_GRASS,
  KIND_CRATE,
  KIND_BARREL,
  type GameMap,
} from './worldmap';
import { onGameEvent } from './events';
import { useKeyboard } from './input';
import { Terrain } from './scene/Terrain';
import { Player } from './scene/Player';
import { Mob } from './scene/Mob';
import { Destructible } from './scene/Destructible';
import { Loot } from './scene/Loot';
import { Projectiles } from './scene/Projectiles';
import { GroundZones } from './scene/GroundZones';
import { DamageNumbers } from './scene/DamageNumbers';
import { Footsteps } from './scene/Footsteps';
import { Corpses } from './scene/Corpses';
import { Effects } from './scene/Effects';
import { Vision } from './scene/Vision';
import { Simulation } from './scene/Simulation';

/** A value computed once and kept stable for the component's life — including
 *  across StrictMode's double-invoked render, unlike a side-effecting useMemo. */
function useConstant<T>(factory: () => T): T {
  const ref = useRef<T | undefined>(undefined);
  if (ref.current === undefined) ref.current = factory();
  return ref.current;
}

/**
 * Roll the destructibles for an area: clusters of breakable crates (cover
 * that stops being cover) and explosive barrels (shoot to detonate; chains).
 * Each occupies one grid cell stamped SOLID here — collision, LOS, and A*
 * treat it as a wall until the entity dies and the sim carves it back.
 *
 * Self-seeded on its own stream so mob rosters don't shift with destructible
 * counts, and idempotent under StrictMode: a re-run makes identical draws,
 * so the "already stamped by us" cells are exactly the ones it re-stamps.
 */
function spawnDestructibles(map: GameMap, area: number, seed: number): Entity[] {
  ROT.RNG.setSeed(seed * 47 + area);
  let pool = 18 + 8 * area;
  const list: Entity[] = [];
  let nextId = 0;
  const placedNow = new Set<string>();
  // Keep clear of the doorstep and the goal, and off grass (a crate on a
  // tuft would orphan the concealment rules under it).
  const candidates = map.floors.filter(
    (c) =>
      Math.hypot(c.x - map.entry.x, c.z - map.entry.z) > 2.5 &&
      Math.hypot(c.x - map.exit.x, c.z - map.exit.z) > 2.5 &&
      map.kinds[c.z * map.width + c.x] !== KIND_GRASS,
  );
  if (candidates.length === 0) return list;

  const NEIGHBORS = [
    [0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1],
  ];
  /** Stamp up to n cells of a cluster around a random center. */
  const cluster = (kind: number, n: number) => {
    const center = candidates[ROT.RNG.getUniformInt(0, candidates.length - 1)];
    const spots = ROT.RNG.shuffle(NEIGHBORS.map(([dx, dz]) => ({ x: center.x + dx, z: center.z + dz })));
    let placed = 0;
    for (const s of spots) {
      if (placed >= n) break;
      if (s.x < 1 || s.z < 1 || s.x > map.width - 2 || s.z > map.height - 2) continue;
      const key = `${s.x},${s.z}`;
      if (placedNow.has(key)) continue;
      const i = s.z * map.width + s.x;
      // Free floor — or a cell WE stamped on a previous run of the same
      // seed (StrictMode): re-stamping it keeps the double-run identical.
      const restampable = map.kinds[i] === KIND_CRATE || map.kinds[i] === KIND_BARREL;
      if ((map.cells[i] !== 0 && !restampable) || map.kinds[i] === KIND_GRASS) continue;
      map.cells[i] = 1;
      map.kinds[i] = kind;
      placedNow.add(key);
      list.push(
        kind === KIND_BARREL
          ? {
              destructible: {
                cell: { x: s.x, z: s.z },
                explosive: { radius: 1.8, damage: 4 + area },
              },
              pos: { x: cellToWorld(s.x), z: cellToWorld(s.z) },
              health: { current: 2, max: 2 },
              hitFlash: 0,
              tint: '#c0392b',
              id: nextId++,
            }
          : {
              destructible: { cell: { x: s.x, z: s.z } },
              pos: { x: cellToWorld(s.x), z: cellToWorld(s.z) },
              health: { current: 5 + 2 * area, max: 5 + 2 * area },
              hitFlash: 0,
              tint: '#a8845c',
              id: nextId++,
            },
      );
      placed++;
    }
  };

  const kinds = [
    { weight: 0.7, cost: 4, build: () => cluster(KIND_CRATE, 2 + ROT.RNG.getUniformInt(0, 2)) },
    { weight: 0.3, cost: 5, build: () => cluster(KIND_BARREL, 2 + ROT.RNG.getUniformInt(0, 1)) },
  ];
  while (pool >= Math.min(...kinds.map((k) => k.cost))) {
    let roll = ROT.RNG.getUniform() * kinds.reduce((s, k) => s + k.weight, 0);
    let pick = kinds[0];
    for (const k of kinds) {
      roll -= k.weight;
      if (roll <= 0) {
        pick = k;
        break;
      }
    }
    if (pick.cost > pool) continue; // reroll — an affordable option exists
    pool -= pick.cost;
    pick.build();
  }
  return list;
}

/**
 * Roll the mob population for an area. Self-seeded so it's deterministic and
 * idempotent (StrictMode double-runs effects; a shared RNG stream would give
 * a different roster on the second pass).
 *
 * The AREA holds the point pool and spends it on PACKS, not individuals —
 * this is a horde game, and the crowd stats on weapons (arc, knockback,
 * pierce, chain…) only pay off against crowds. Each pack is a behavioral
 * archetype: a swarm of one-hit chaff, fast rushers, standoff snipers, a
 * clutch of walking bombs, a spawner seeping reinforcements, or an elite
 * with an installed mechanism and an escort. Everything a mob might drop
 * (its weapon, a mechanism part) is pre-rolled here too, so kills draw no
 * RNG mid-combat.
 */
function spawnMobs(map: GameMap, area: number, blockedCells: Set<string>, seed: number): Entity[] {
  ROT.RNG.setSeed(seed * 31 + area);
  const pool = 110 + 45 * (area - 1);
  // Keep spawns off the player's doorstep so areas start quiet. `map.floors`
  // is a generation-time snapshot, so cells the destructibles stamped solid
  // must be filtered out explicitly or a mob could spawn inside a crate.
  const candidates = map.floors.filter(
    (c) =>
      Math.hypot(c.x - map.entry.x, c.z - map.entry.z) > 12 &&
      !blockedCells.has(`${c.x},${c.z}`),
  );
  // The exit is a defended objective: cells around it host the guard share
  // of the pool, the rest of the map gets the remainder as free roamers.
  const exitCells = candidates.filter(
    (c) => Math.hypot(c.x - map.exit.x, c.z - map.exit.z) < 9,
  );
  const list: Entity[] = [];
  let nextId = 0;
  /** Power tier of dropped mechanism parts, creeping up with depth. */
  const partTier = Math.max(1, Math.min(4, Math.ceil(area / 2)));

  /** Random floor cell near a pack's center (packs arrive as groups). */
  const near = (center: { x: number; z: number }) => {
    const close = candidates.filter((c) => Math.hypot(c.x - center.x, c.z - center.z) < 4);
    const from = close.length > 0 ? close : candidates;
    return from[ROT.RNG.getUniformInt(0, from.length - 1)];
  };

  /** Pre-roll what a mob leaves behind: maybe a gun, maybe a part. The
   *  player is ranged-only, so swords never drop — but the horde is mostly
   *  sword-carriers, and a loot game where most kills can't pay out guns is
   *  a loot game with no guns. So melee carriers SCAVENGE: a fraction of
   *  them hold a looted gun (rolled fresh here, spawn-time RNG), and drop
   *  that. Gun-carriers still drop the gun they shot you with. */
  const rollDrops = (weapon: WeaponDef | undefined, weaponChance: number, partChance: number) => {
    if (weapon && ROT.RNG.getUniform() < weaponChance) {
      if (weapon.kind === 'ranged') return { weapon };
      return { weapon: generateWeapon('ranged', 1, 4 + ROT.RNG.getUniformInt(0, 2 + 2 * area)) };
    }
    if (ROT.RNG.getUniform() < partChance) return { part: generateMechanism(partTier) };
    return undefined;
  };

  interface MobSpec {
    level: number;
    hp: number;
    speed: number;
    tint: string;
    weapon?: WeaponDef;
    drops?: Entity['drops'];
    volatile?: Entity['volatile'];
    spawner?: Entity['spawner'];
    resist?: Entity['resist'];
    /** Vision overrides — otherwise each mob rolls its own cone. */
    sight?: number;
    fov?: number;
    hearing?: number;
    /** Guard leash: >0 stations the mob on its spawn cell (see brain.post). */
    postRadius?: number;
  }
  // What a mob WIELDS is a detuned copy of its roll (they outnumber you
  // ~30:1 — full listed damage was near-one-shot territory); what it DROPS
  // stays the full-strength original. Same combat code path, stats differ.
  const mobTuned = (w: WeaponDef): WeaponDef => ({
    ...w,
    damage: Math.max(1, Math.round(w.damage * 0.65)),
  });

  const makeMob = (cell: { x: number; z: number }, s: MobSpec): Entity => ({
    mob: true,
    id: nextId++,
    level: s.level,
    tint: s.tint,
    health: { current: s.hp, max: s.hp },
    hitFlash: 0,
    resist: s.resist ?? { knockback: 0, stagger: 0 },
    moveSpeed: s.speed,
    weapon: s.weapon && mobTuned(s.weapon),
    drops: s.drops,
    volatile: s.volatile,
    spawner: s.spawner,
    aim: { x: 0, z: 1 }, // faces the player once alerted; swings sweep around it
    pos: { x: cellToWorld(cell.x), z: cellToWorld(cell.z) },
    vel: { x: 0, z: 0 },
    radius: 0.28 + 0.04 * (s.level - 1),
    brain: {
      path: [],
      // Spread the A* recomputes across frames so a horde doesn't repath
      // in lockstep.
      repathIn: ROT.RNG.getUniform() * 0.25,
      // Vision varies per mob: cone length and width are individual rolls
      // (capped under the player's 7-unit vision, so you can spot them
      // first), and hearing is short — slipping behind a mob is a real
      // move. The view draws each cone.
      sight: s.sight ?? +(4.5 + ROT.RNG.getUniform() * 2).toFixed(1),
      fov: s.fov ?? +(0.5 + ROT.RNG.getUniform() * 0.6).toFixed(2),
      hearing: s.hearing ?? +(2.5 + ROT.RNG.getUniform() * 1.5).toFixed(1),
      alerted: false,
      // Melee walks up to swing reach; ranged stands off inside gun range;
      // exploders push in to fuse range; spawners never move.
      attackRange: s.spawner
        ? 9999
        : s.volatile
          ? 0.4
          : s.weapon
            ? s.weapon.kind === 'melee'
              ? s.weapon.reach * 0.9
              : s.weapon.reach * 0.6
            : 1,
      attackIn: 0,
      stagger: 0,
      wanderTarget: undefined,
      wanderIn: ROT.RNG.getUniform() * 3,
      post: s.postRadius
        ? { x: cellToWorld(cell.x), z: cellToWorld(cell.z), radius: s.postRadius }
        : undefined,
    },
  });

  /** Swarm chaff — shared by swarm packs and spawner reinforcements. A
   *  couple of hits each (scaling with depth): a crowd you mow, not a tide
   *  that forces permanent backpedaling — but no longer a field of
   *  one-tap piñatas. Rushers are the fast exception. */
  const chaff = (cell: { x: number; z: number }, postRadius = 0): Entity => {
    const weapon = generateWeapon('melee', 1, 3 + ROT.RNG.getUniformInt(0, 2));
    return makeMob(cell, {
      level: 1,
      hp: 2 + ROT.RNG.getUniformInt(0, 1) + (area - 1),
      speed: +(2.4 + ROT.RNG.getUniform() * 0.4).toFixed(2),
      tint: '#5fd35f',
      weapon,
      drops: rollDrops(weapon, 0.2, 0.18),
      postRadius,
    });
  };

  // Pack archetypes: [weights, cost, builder]. The pool buys packs until it
  // runs dry; scatter weights skew toward swarms so the field reads as a
  // horde with punctuation, not a lineup of minibosses. Guard weights pick
  // who stands watch at the exit: watchful and dangerous archetypes — no
  // swarms (they read as scatter) and no spawners (they never move anyway).
  interface Pack {
    weight: number;
    guardWeight: number;
    cost: number;
    build: (center: { x: number; z: number }, postRadius: number) => void;
  }
  const packs: Pack[] = [
    {
      weight: 0.3,
      guardWeight: 0,
      cost: 16,
      build: (center, postRadius) => {
        const n = 6 + ROT.RNG.getUniformInt(0, 4);
        for (let i = 0; i < n; i++) list.push(chaff(near(center), postRadius));
      },
    },
    {
      weight: 0.14,
      guardWeight: 0.25,
      cost: 14,
      build: (center, postRadius) => {
        const n = 3 + ROT.RNG.getUniformInt(0, 2);
        for (let i = 0; i < n; i++) {
          const weapon = generateWeapon('melee', 1, 5);
          list.push(
            makeMob(near(center), {
              level: 1,
              hp: 4 + (area - 1),
              speed: +(4.1 + ROT.RNG.getUniform() * 0.3).toFixed(2),
              tint: '#3fbf8f',
              weapon,
              drops: rollDrops(weapon, 0.25, 0.2),
              postRadius,
            }),
          );
        }
      },
    },
    {
      weight: 0.15,
      guardWeight: 0.35,
      cost: 12,
      build: (center, postRadius) => {
        const n = 2 + ROT.RNG.getUniformInt(0, 1);
        for (let i = 0; i < n; i++) {
          const weapon = generateWeapon('ranged', 1, 6 + 2 * area);
          list.push(
            makeMob(near(center), {
              level: 1,
              hp: 4 + area,
              speed: 2.4,
              tint: '#7fb2e8',
              weapon,
              drops: rollDrops(weapon, 0.65, 0.2),
              // A watchman's gaze: long and narrow.
              sight: +(7.5 + ROT.RNG.getUniform() * 1.5).toFixed(1),
              fov: +(0.35 + ROT.RNG.getUniform() * 0.15).toFixed(2),
              postRadius,
            }),
          );
        }
      },
    },
    {
      weight: 0.15,
      guardWeight: 0.15,
      cost: 12,
      build: (center, postRadius) => {
        const n = 3 + ROT.RNG.getUniformInt(0, 2);
        for (let i = 0; i < n; i++) {
          list.push(
            makeMob(near(center), {
              level: 1,
              hp: 2,
              speed: 4.2,
              tint: '#ff8c42',
              volatile: { radius: 1.7, damage: 2 + area, fuse: 0.55, lit: false },
              drops: rollDrops(undefined, 0, 0.2),
              // Twitchy: short, wide, and sharp-eared.
              sight: 4,
              fov: +(1.0 + ROT.RNG.getUniform() * 0.2).toFixed(2),
              hearing: 3.5,
              postRadius,
            }),
          );
        }
      },
    },
    {
      weight: 0.08,
      guardWeight: 0,
      cost: 18,
      build: (center) => {
        const pending: Entity[] = [];
        for (let i = 0; i < 4 + area; i++) pending.push(chaff(center));
        list.push(
          makeMob(center, {
            level: 2,
            hp: 14 + 4 * area,
            speed: 0,
            tint: '#b07fe8',
            spawner: { interval: 2.2, next: 1.0, pending },
            drops: { part: generateMechanism(partTier) },
            resist: { knockback: 0.8, stagger: 0.5 },
          }),
        );
      },
    },
    {
      weight: 0.18,
      guardWeight: 0.25,
      cost: 20,
      build: (center, postRadius) => {
        const level = Math.min(3, 1 + Math.ceil(area / 2));
        // Elites carry guns: the marquee drops of a ranged-only player.
        const weapon = generateWeapon('ranged', level, weaponBudget(level) + 3 + area);
        // Elites come pre-constructed: a mechanism already in a fitting —
        // you see the behavior used against you before you loot it.
        if (weapon.slots > 0) weapon.mechanisms.push(generateMechanism(partTier));
        list.push(
          makeMob(center, {
            level,
            hp: 12 + 5 * area,
            speed: 3.2,
            tint: level >= 3 ? '#d35f5f' : '#d3a75f',
            weapon,
            // The area's jackpot: always the gun AND a good cog.
            drops: { weapon, part: generateMechanism(partTier + 1) },
            resist: { knockback: 0.4 + 0.1 * level, stagger: 0.3 + 0.1 * level },
            postRadius,
          }),
        );
        for (let i = 0; i < 2; i++) list.push(chaff(near(center), postRadius));
      },
    },
  ];

  /** Spend a point budget on packs centered on cells from `centers`. Guard
   *  purchases use the guard weights and roll each pack a leash: mostly
   *  tight sentries, sometimes a wide patroller. */
  const runPool = (points: number, centers: Array<{ x: number; z: number }>, guard: boolean) => {
    const weightOf = (p: Pack) => (guard ? p.guardWeight : p.weight);
    const eligible = packs.filter((p) => weightOf(p) > 0);
    if (eligible.length === 0 || centers.length === 0) return;
    const totalWeight = eligible.reduce((s, p) => s + weightOf(p), 0);
    const minCost = Math.min(...eligible.map((p) => p.cost));
    while (points >= minCost) {
      let roll = ROT.RNG.getUniform() * totalWeight;
      let pick = eligible[0];
      for (const p of eligible) {
        roll -= weightOf(p);
        if (roll <= 0) {
          pick = p;
          break;
        }
      }
      if (pick.cost > points) continue; // reroll — an affordable pack exists
      points -= pick.cost;
      const center = centers[ROT.RNG.getUniformInt(0, centers.length - 1)];
      const postRadius = guard
        ? ROT.RNG.getUniform() < 0.6
          ? 1.5 + ROT.RNG.getUniform()
          : 3.5 + ROT.RNG.getUniform() * 2.5
        : 0;
      pick.build(center, postRadius);
    }
  };

  // Guard purchases first (fixed draw order keeps the roster deterministic),
  // then the rest of the pool scatters across the map as before.
  const guardPool = exitCells.length > 0 ? Math.round(pool * 0.35) : 0;
  runPool(guardPool, exitCells, true);
  runPool(pool - guardPool, candidates, false);
  return list;
}

/**
 * One run of the game: everything derives from the world seed and the picked
 * character. The shell (App) mounts one Game per run — starting a new run is
 * a remount, so no per-run state needs manual resetting.
 *
 * The run owns its pause overlay (GameMenu: pack + help + continue/new game)
 * because the pack state lives here; App only owns WHETHER it shows —
 * `paused` holds the sim, `menuOpen` raises the overlay (they differ when
 * the character-select screen covers a paused run), `onOpenMenu` asks App
 * to pause (the ⚙ button / pack hotkey), and Esc/backgrounding go through
 * App directly.
 */
export function Game({
  seed,
  character,
  paused,
  menuOpen,
  onOpenMenu,
  onResume,
  onNewGame,
}: {
  seed: number;
  character: CharacterDef;
  paused: boolean;
  menuOpen: boolean;
  onOpenMenu: () => void;
  onResume: () => void;
  onNewGame: () => void;
}) {
  // Area number drives the seed: reaching the exit regenerates everything.
  const [area, setArea] = useState(1);
  const map = useMemo(() => generateWorldMap(64, 64, seed + area), [seed, area]);

  // Coarse pointer = phone/tablet: bigger zoom and touch sticks. The pack
  // lives in the pause overlay on every layout now.
  const isCoarse = useConstant(() => window.matchMedia('(pointer: coarse)').matches);
  const [menuTab, setMenuTab] = useState<GameMenuTab>('pack');
  useEffect(initTouch, []);

  /** Open the pause overlay on a given tab (the ⚙ button and hotkeys). */
  const openMenu = useCallback(
    (tab: GameMenuTab) => {
      setMenuTab(tab);
      onOpenMenu();
    },
    [onOpenMenu],
  );

  // Ortho zoom is CSS pixels per world unit. 42 suits a desktop monitor;
  // on a phone that renders a mob at ~3 mm. Scale so the view spans ~15
  // world units across the width — physically chunky, still enough lookahead
  // to kite (your 7-unit vision just fits ahead of you).
  const zoom = useConstant(() =>
    isCoarse ? Math.min(64, Math.max(46, Math.round(window.innerWidth / 15))) : 42,
  );

  // The body you steer is the archetype's spend made flesh: HP, speed, and
  // resist come off the character sheet; the sim reads them like any mob's.
  const playerEntity = useConstant<Entity>(() => ({
    player: true,
    health: { current: characterHp(character), max: characterHp(character) },
    hitFlash: 0,
    stun: 0,
    reveal: 0,
    tint: character.tint,
    moveSpeed: characterSpeed(character),
    resist: characterResist(character),
    pos: { x: 0, z: 0 }, // placed at the area entry by the effect below
    vel: { x: 0, z: 0 },
    radius: 0.35,
  }));
  const [playerHp, setPlayerHp] = useState(() => characterHp(character));

  // Entering an area: player starts at the west-edge entry; destructibles
  // stamp their cells first (mob spawn candidates must avoid them), then
  // the mob roster rolls.
  const [mobEntities, setMobEntities] = useState<Entity[]>([]);
  const [destructibleEntities, setDestructibleEntities] = useState<Entity[]>([]);
  useEffect(() => {
    playerEntity.pos!.x = cellToWorld(map.entry.x);
    playerEntity.pos!.z = cellToWorld(map.entry.z);
    playerEntity.vel!.x = 0;
    playerEntity.vel!.z = 0;
    const ds = spawnDestructibles(map, area, seed);
    setDestructibleEntities(ds);
    const blocked = new Set(ds.map((d) => `${d.destructible!.cell.x},${d.destructible!.cell.z}`));
    setMobEntities(spawnMobs(map, area, blocked, seed));
  }, [map, area, seed, playerEntity]);

  // World membership is managed in effects (not during render) so it stays
  // correct under StrictMode. Dead mobs are already out of the world; the
  // cleanup guard keeps their removal idempotent.
  useEffect(() => {
    world.add(playerEntity);
    return () => {
      world.remove(playerEntity);
    };
  }, [playerEntity]);
  useEffect(() => {
    for (const m of mobEntities) world.add(m);
    return () => {
      for (const m of mobEntities) if (world.has(m)) world.remove(m);
    };
  }, [mobEntities]);
  useEffect(() => {
    for (const d of destructibleEntities) world.add(d);
    return () => {
      for (const d of destructibleEntities) if (world.has(d)) world.remove(d);
    };
  }, [destructibleEntities]);

  // Inventory: pickups collect here; nothing auto-equips (grabbing a worse
  // gun mid-fight must never disarm you). The equipped weapon is a member of
  // the inventory, referenced by id; it drives BOTH the rendered gun (prop)
  // and the simulation (mirrored into the entity so combat reads the right
  // stats). The player is ranged-only — the starter is a generated gun,
  // rolled to the archetype's shape (see characters.rollStarterWeapon).
  const starterWeapon = useConstant(() => rollStarterWeapon(character, seed));
  const [inventory, setInventory] = useState<WeaponDef[]>([starterWeapon]);
  const [parts, setParts] = useState<MechanismDef[]>([]);
  const [equippedId, setEquippedId] = useState(starterWeapon.id);
  const playerWeapon = inventory.find((w) => w.id === equippedId) ?? inventory[0];
  useEffect(() => { playerEntity.weapon = playerWeapon; }, [playerWeapon, playerEntity]);

  // Kill-streak combo: kills within 2s of each other chain a multiplier.
  const [kills, setKills] = useState(0);
  const [combo, setCombo] = useState(0);
  const comboRef = useRef({ n: 0, last: 0 });
  const comboTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Installing a cog from the satchel: fills a free fitting on the equipped
  // weapon, or bumps the oldest install back into the satchel when full.
  const installPart = useCallback(
    (part: MechanismDef) => {
      const w = inventory.find((x) => x.id === equippedId) ?? inventory[0];
      if (!w || !part.kinds.includes(w.kind)) return;
      const full = w.mechanisms.length >= w.slots;
      const bumped = full ? w.mechanisms[0] : undefined;
      const mechanisms = full ? [...w.mechanisms.slice(1), part] : [...w.mechanisms, part];
      setInventory((inv) => inv.map((x) => (x.id === w.id ? { ...x, mechanisms } : x)));
      setParts((list) => {
        const next = list.filter((p) => p.id !== part.id);
        return bumped ? [...next, bumped] : next;
      });
    },
    [inventory, equippedId],
  );

  const discardWeapon = useCallback(
    (id: string) => {
      if (id === equippedId) return; // never disarm yourself
      setInventory((inv) => inv.filter((w) => w.id !== id));
    },
    [equippedId],
  );
  const discardPart = useCallback((id: string) => {
    setParts((list) => list.filter((p) => p.id !== id));
  }, []);

  // Sim → React: deaths unmount mob views (and feed the combo counter),
  // spawners mount reinforcements, pickups land in the inventory, the exit
  // advances to the next area, damage keeps the HP readout live, and player
  // death soft-respawns at the area entry with full HP.
  useEffect(
    () =>
      onGameEvent((e) => {
        if (e.type === 'mobDied') {
          setMobEntities((list) => list.filter((m) => m !== e.mob));
          setKills((k) => k + 1);
          const now = performance.now();
          const c = comboRef.current;
          c.n = now - c.last < 2000 ? c.n + 1 : 1;
          c.last = now;
          setCombo(c.n);
          clearTimeout(comboTimeout.current);
          comboTimeout.current = setTimeout(() => setCombo(0), 2000);
        } else if (e.type === 'destructibleDied') {
          setDestructibleEntities((list) => list.filter((d) => d !== e.entity));
        } else if (e.type === 'mobsSpawned') setMobEntities((list) => [...list, ...e.mobs]);
        else if (e.type === 'pickup') setInventory((inv) => [...inv, e.weapon]);
        else if (e.type === 'pickupPart') setParts((list) => [...list, e.part]);
        else if (e.type === 'exitReached') setArea((a) => a + 1);
        else if (e.type === 'damage' && e.target === 'player') {
          setPlayerHp(Math.max(0, playerEntity.health!.current));
        } else if (e.type === 'playerDied') {
          playerEntity.health!.current = playerEntity.health!.max;
          playerEntity.pos!.x = cellToWorld(map.entry.x);
          playerEntity.pos!.z = cellToWorld(map.entry.z);
          playerEntity.vel!.x = 0;
          playerEntity.vel!.z = 0;
          playerEntity.stun = 0;
          setPlayerHp(playerEntity.health!.max);
        }
      }),
    [playerEntity, map],
  );

  const handlers = useMemo(
    () => ({
      // dev: roll a fresh gun straight into hand / toss a random cog into
      // the satchel.
      Digit1: () => {
        const w = generateWeapon('ranged', area);
        setInventory((inv) => [...inv, w]);
        setEquippedId(w.id);
      },
      Digit2: () => setParts((list) => [...list, generateMechanism(area)]),
      KeyI: () => openMenu('pack'),
      KeyH: () => openMenu('help'),
    }),
    [area, openMenu],
  );
  useKeyboard(handlers);

  return (
    <>
      {/* "percentage" = PCFShadowMap. Bare `shadows` selects PCFSoftShadowMap,
          which three deprecated in 0.185 and silently substitutes PCF for —
          so this is the renderer we were already getting, just stated. */}
      <Canvas shadows="percentage">
        <color attach="background" args={['#0f1117']} />
        <OrthographicCamera
          makeDefault
          position={[cellToWorld(map.entry.x), 12, cellToWorld(map.entry.z) + 8]}
          zoom={zoom}
          near={0.1}
          far={200}
        />

        <ambientLight intensity={0.5} />
        <directionalLight
          position={[10, 20, 10]}
          intensity={1.1}
          castShadow
          shadow-mapSize={[2048, 2048]}
        />

        <Terrain map={map} />
        <Player entity={playerEntity} weapon={playerWeapon} map={map} />
        {mobEntities.map((m) => (
          <Mob key={`${area}-${m.id}`} entity={m} map={map} />
        ))}
        {destructibleEntities.map((d) => (
          <Destructible key={`${area}-d${d.id}`} entity={d} />
        ))}
        <Loot />
        <Projectiles />
        <GroundZones />
        <Footsteps entity={playerEntity} />
        <Corpses />
        <Effects />
        <DamageNumbers />
        <Vision entity={playerEntity} />
        <Simulation map={map} paused={paused} />
      </Canvas>

      <TouchSticks />

      {combo >= 2 && (
        <div className="combo" key={combo}>
          ×{combo}
        </div>
      )}

      {/* The whole in-game HUD: one status line. Everything else (pack,
          help, run info) lives in the pause overlay. */}
      <div className="hud-strip">
        HP <b className={playerHp <= playerEntity.health!.max * 0.3 ? 'hp-low' : ''}>{playerHp}</b>
        /{playerEntity.health!.max} · area {area} · {mobEntities.length} mobs · {kills} kills
      </div>

      {!paused && (
        <button className="menu-open" onClick={() => openMenu('pack')}>
          ⚙
        </button>
      )}

      {menuOpen && (
        <GameMenu
          character={character}
          seed={seed}
          area={area}
          kills={kills}
          tab={menuTab}
          onTab={setMenuTab}
          onResume={onResume}
          onNewGame={onNewGame}
        >
          <Inventory
            weapons={inventory}
            parts={parts}
            equippedId={playerWeapon.id}
            onEquip={setEquippedId}
            onDiscardWeapon={discardWeapon}
            onInstall={installPart}
            onDiscardPart={discardPart}
          />
        </GameMenu>
      )}
    </>
  );
}
