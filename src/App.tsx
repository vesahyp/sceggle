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
import { Inventory } from './Inventory';
import { generateWorldMap, cellToWorld, type GameMap } from './worldmap';
import { onGameEvent } from './events';
import { useKeyboard } from './input';
import { Terrain } from './scene/Terrain';
import { Player } from './scene/Player';
import { Mob } from './scene/Mob';
import { Loot } from './scene/Loot';
import { Projectiles } from './scene/Projectiles';
import { DamageNumbers } from './scene/DamageNumbers';
import { Footsteps } from './scene/Footsteps';
import { Corpses } from './scene/Corpses';
import { Effects } from './scene/Effects';
import { Vision } from './scene/Vision';
import { Simulation } from './scene/Simulation';

const SEED = 1337;

/** A value computed once and kept stable for the component's life — including
 *  across StrictMode's double-invoked render, unlike a side-effecting useMemo. */
function useConstant<T>(factory: () => T): T {
  const ref = useRef<T | undefined>(undefined);
  if (ref.current === undefined) ref.current = factory();
  return ref.current;
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
function spawnMobs(map: GameMap, area: number): Entity[] {
  ROT.RNG.setSeed(SEED * 31 + area);
  let pool = 110 + 45 * (area - 1);
  // Keep spawns off the player's doorstep so areas start quiet.
  const candidates = map.floors.filter(
    (c) => Math.hypot(c.x - map.entry.x, c.z - map.entry.z) > 12,
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

  /** Pre-roll what a mob leaves behind: maybe its weapon, maybe a part.
   *  Only gun-carriers ever drop weapons — the player is ranged-only, so a
   *  dropped sword would be inventory litter. */
  const rollDrops = (weapon: WeaponDef | undefined, weaponChance: number, partChance: number) => {
    if (weapon && weapon.kind === 'ranged' && ROT.RNG.getUniform() < weaponChance) return { weapon };
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
  }
  const makeMob = (cell: { x: number; z: number }, s: MobSpec): Entity => ({
    mob: true,
    id: nextId++,
    level: s.level,
    tint: s.tint,
    health: { current: s.hp, max: s.hp },
    hitFlash: 0,
    resist: s.resist ?? { knockback: 0, stagger: 0 },
    moveSpeed: s.speed,
    weapon: s.weapon,
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
    },
  });

  /** One-hit swarm chaff — shared by swarm packs and spawner reinforcements.
   *  Clearly slower than the player (5): a crowd you mow, not a tide that
   *  forces permanent backpedaling. Rushers are the fast exception. */
  const chaff = (cell: { x: number; z: number }): Entity => {
    const weapon = generateWeapon('melee', 1, 3 + ROT.RNG.getUniformInt(0, 2));
    return makeMob(cell, {
      level: 1,
      hp: 1 + ROT.RNG.getUniformInt(0, 1),
      speed: +(2.4 + ROT.RNG.getUniform() * 0.4).toFixed(2),
      tint: '#5fd35f',
      weapon,
      drops: rollDrops(weapon, 0.2, 0.18),
    });
  };

  // Pack archetypes: [weight, cost, builder]. The pool buys packs until it
  // runs dry; weights skew toward swarms so the field reads as a horde with
  // punctuation, not a lineup of minibosses.
  const packs: Array<{ weight: number; cost: number; build: () => void }> = [
    {
      weight: 0.3,
      cost: 16,
      build: () => {
        const center = candidates[ROT.RNG.getUniformInt(0, candidates.length - 1)];
        const n = 6 + ROT.RNG.getUniformInt(0, 4);
        for (let i = 0; i < n; i++) list.push(chaff(near(center)));
      },
    },
    {
      weight: 0.14,
      cost: 14,
      build: () => {
        const center = candidates[ROT.RNG.getUniformInt(0, candidates.length - 1)];
        const n = 3 + ROT.RNG.getUniformInt(0, 2);
        for (let i = 0; i < n; i++) {
          const weapon = generateWeapon('melee', 1, 5);
          list.push(
            makeMob(near(center), {
              level: 1,
              hp: 2,
              speed: +(4.1 + ROT.RNG.getUniform() * 0.3).toFixed(2),
              tint: '#3fbf8f',
              weapon,
              drops: rollDrops(weapon, 0.25, 0.2),
            }),
          );
        }
      },
    },
    {
      weight: 0.15,
      cost: 12,
      build: () => {
        const center = candidates[ROT.RNG.getUniformInt(0, candidates.length - 1)];
        const n = 2 + ROT.RNG.getUniformInt(0, 1);
        for (let i = 0; i < n; i++) {
          const weapon = generateWeapon('ranged', 1, 8 + 2 * area);
          list.push(
            makeMob(near(center), {
              level: 1,
              hp: 2,
              speed: 2.4,
              tint: '#7fb2e8',
              weapon,
              drops: rollDrops(weapon, 0.65, 0.2),
              // A watchman's gaze: long and narrow.
              sight: +(7.5 + ROT.RNG.getUniform() * 1.5).toFixed(1),
              fov: +(0.35 + ROT.RNG.getUniform() * 0.15).toFixed(2),
            }),
          );
        }
      },
    },
    {
      weight: 0.15,
      cost: 12,
      build: () => {
        const center = candidates[ROT.RNG.getUniformInt(0, candidates.length - 1)];
        const n = 3 + ROT.RNG.getUniformInt(0, 2);
        for (let i = 0; i < n; i++) {
          list.push(
            makeMob(near(center), {
              level: 1,
              hp: 1,
              speed: 4.2,
              tint: '#ff8c42',
              volatile: { radius: 1.7, damage: 3 + area, fuse: 0.55, lit: false },
              drops: rollDrops(undefined, 0, 0.2),
              // Twitchy: short, wide, and sharp-eared.
              sight: 4,
              fov: +(1.0 + ROT.RNG.getUniform() * 0.2).toFixed(2),
              hearing: 3.5,
            }),
          );
        }
      },
    },
    {
      weight: 0.08,
      cost: 18,
      build: () => {
        const center = candidates[ROT.RNG.getUniformInt(0, candidates.length - 1)];
        const pending: Entity[] = [];
        for (let i = 0; i < 4 + area; i++) pending.push(chaff(center));
        list.push(
          makeMob(center, {
            level: 2,
            hp: 10 + 3 * area,
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
      cost: 20,
      build: () => {
        const center = candidates[ROT.RNG.getUniformInt(0, candidates.length - 1)];
        const level = Math.min(3, 1 + Math.ceil(area / 2));
        // Elites carry guns: the marquee drops of a ranged-only player.
        const weapon = generateWeapon('ranged', level, weaponBudget(level) + 6 + 2 * area);
        // Elites come pre-constructed: a mechanism already in a fitting —
        // you see the behavior used against you before you loot it.
        if (weapon.slots > 0) weapon.mechanisms.push(generateMechanism(partTier));
        list.push(
          makeMob(center, {
            level,
            hp: 8 + 3 * area,
            speed: 3.2,
            tint: level >= 3 ? '#d35f5f' : '#d3a75f',
            weapon,
            // The area's jackpot: always the gun AND a good cog.
            drops: { weapon, part: generateMechanism(partTier + 1) },
            resist: { knockback: 0.4 + 0.1 * level, stagger: 0.3 + 0.1 * level },
          }),
        );
        for (let i = 0; i < 2; i++) list.push(chaff(near(center)));
      },
    },
  ];
  const totalWeight = packs.reduce((s, p) => s + p.weight, 0);

  while (pool >= Math.min(...packs.map((p) => p.cost))) {
    let roll = ROT.RNG.getUniform() * totalWeight;
    let pick = packs[0];
    for (const p of packs) {
      roll -= p.weight;
      if (roll <= 0) {
        pick = p;
        break;
      }
    }
    if (pick.cost > pool) continue; // reroll — an affordable pack exists
    pool -= pick.cost;
    pick.build();
  }
  return list;
}

export default function App() {
  // Area number drives the seed: reaching the exit regenerates everything.
  const [area, setArea] = useState(1);
  const map = useMemo(() => generateWorldMap(64, 64, SEED + area), [area]);

  const playerEntity = useConstant<Entity>(() => ({
    player: true,
    health: { current: 20, max: 20 },
    hitFlash: 0,
    stun: 0,
    pos: { x: 0, z: 0 }, // placed at the area entry by the effect below
    vel: { x: 0, z: 0 },
    radius: 0.35,
  }));
  const [playerHp, setPlayerHp] = useState(20);

  // Entering an area: player starts at the west-edge entry, mobs roll fresh.
  const [mobEntities, setMobEntities] = useState<Entity[]>([]);
  useEffect(() => {
    playerEntity.pos!.x = cellToWorld(map.entry.x);
    playerEntity.pos!.z = cellToWorld(map.entry.z);
    playerEntity.vel!.x = 0;
    playerEntity.vel!.z = 0;
    setMobEntities(spawnMobs(map, area));
  }, [map, area, playerEntity]);

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

  // Inventory: pickups collect here; nothing auto-equips (grabbing a worse
  // gun mid-fight must never disarm you). The equipped weapon is a member of
  // the inventory, referenced by id; it drives BOTH the rendered gun (prop)
  // and the simulation (mirrored into the entity so combat reads the right
  // stats). The player is ranged-only — the starter is a generated gun.
  // A few bonus points over a plain level-1 roll, and never a dud: the
  // opening gun has to carry the first horde on its own, so reroll (still
  // seeded → deterministic) until damage and cadence clear a floor. Drops
  // keep their spiky rolls — the slot machine starts with the first pickup.
  const starterWeapon = useConstant(() => {
    let w = generateWeapon('ranged', 1, weaponBudget(1) + 4);
    for (let i = 0; i < 20 && (w.damage < 3 || w.rate < 1); i++) {
      w = generateWeapon('ranged', 1, weaponBudget(1) + 4);
    }
    return w;
  });
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
    }),
    [area],
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
          zoom={42}
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
          <Mob key={`${area}-${m.id}`} entity={m} />
        ))}
        <Loot />
        <Projectiles />
        <Footsteps entity={playerEntity} />
        <Corpses />
        <Effects />
        <DamageNumbers />
        <Vision entity={playerEntity} />
        <Simulation map={map} />
      </Canvas>

      {combo >= 2 && (
        <div className="combo" key={combo}>
          ×{combo}
        </div>
      )}

      <Inventory
        weapons={inventory}
        parts={parts}
        equippedId={playerWeapon.id}
        onEquip={setEquippedId}
        onDiscardWeapon={discardWeapon}
        onInstall={installPart}
        onDiscardPart={discardPart}
      />

      <div className="hud">
        <h1>sceggle</h1>
        <p className="sub">three.js · Miniplex · rot.js</p>
        <ul>
          <li><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move · <kbd>Mouse</kbd> aim</li>
          <li><kbd>Click</kbd> / <kbd>Space</kbd> attack (hold to keep firing at the cursor)</li>
          <li>Walk over drops to collect — equip guns and install cogs in the pack (right)</li>
          <li>Reach the gold pad to leave the area</li>
          <li><kbd>1</kbd> dev: roll a gun into hand · <kbd>2</kbd> dev: a random cog into the pack</li>
        </ul>
        <div className="stat">
          Area <b>{area}</b> · {mobEntities.length} mobs left · {kills} kills · HP{' '}
          <b>{playerHp}</b>/{playerEntity.health!.max}
        </div>
        <div className="stat">
          Exploders (orange) blow up both sides · spawners (purple) leak chaff while you're seen.
        </div>
        <div className="stat">
          Idle mobs wander; the blue cone is where one looks, the gold ring how far it hears.
          Your footsteps ripple — keep them outside the ring and out of the cone to sneak.
        </div>
      </div>
    </>
  );
}
