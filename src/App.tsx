import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrthographicCamera } from '@react-three/drei';
import * as ROT from 'rot-js';
import { world, type Entity } from './ecs';
import { generateWeapon, randomWeapon, weaponBudget } from './weapons';
import { generateWorldMap, cellToWorld, type GameMap } from './worldmap';
import { onGameEvent } from './events';
import { useKeyboard } from './input';
import { Terrain } from './scene/Terrain';
import { Player } from './scene/Player';
import { Mob } from './scene/Mob';
import { Loot } from './scene/Loot';
import { Projectiles } from './scene/Projectiles';
import { DamageNumbers } from './scene/DamageNumbers';
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
 * A mob is *generated* from a point pool (4 + 5·level): each point buys one
 * of hit points, move speed, knockback resistance, stagger resistance, or
 * extra budget for its weapon — which is itself rolled from the weapon
 * generator, and is exactly what the mob drops when it dies.
 */
function spawnMobs(map: GameMap, area: number): Entity[] {
  ROT.RNG.setSeed(SEED * 31 + area);
  const count = 4 + 2 * (area - 1);
  // Keep spawns off the player's doorstep so areas start quiet.
  const candidates = map.floors.filter(
    (c) => Math.hypot(c.x - map.entry.x, c.z - map.entry.z) > 12,
  );

  const list: Entity[] = [];
  for (let i = 0; i < count; i++) {
    const c = candidates[ROT.RNG.getUniformInt(0, candidates.length - 1)];
    const level = ROT.RNG.getUniform() < 0.25 ? area + 1 : area;

    // Allocate the pool: hp +1 · speed +0.12 · either resist +0.06 · weapon +2 budget.
    const pts = { hp: 0, speed: 0, resistKb: 0, resistSt: 0, weapon: 0 };
    const keys = Object.keys(pts) as Array<keyof typeof pts>;
    for (let p = 0; p < 4 + 5 * level; p++) pts[keys[ROT.RNG.getUniformInt(0, keys.length - 1)]]++;

    const hp = 2 + pts.hp;
    const weapon = randomWeapon(level, weaponBudget(level) + 2 * pts.weapon);
    list.push({
      mob: true,
      id: i,
      level,
      health: { current: hp, max: hp },
      hitFlash: 0,
      resist: {
        knockback: Math.min(0.85, pts.resistKb * 0.06),
        stagger: Math.min(0.85, pts.resistSt * 0.06),
      },
      moveSpeed: +(3.0 + pts.speed * 0.12).toFixed(2),
      weapon,
      aim: { x: 0, z: 1 }, // faces the player once alerted; swings sweep around it
      pos: { x: cellToWorld(c.x), z: cellToWorld(c.z) },
      vel: { x: 0, z: 0 },
      radius: 0.32,
      brain: {
        path: [],
        repathIn: 0,
        // Slightly inside the player's 7-unit vision: you spot them first.
        sight: 6,
        hearing: 4,
        alerted: false,
        // Melee walks up to swing reach; ranged stands off inside gun range.
        attackRange: weapon.kind === 'melee' ? weapon.reach * 0.9 : weapon.reach * 0.6,
        attackIn: 0,
        stagger: 0,
      },
    });
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

  // Reactive equipment state drives BOTH the rendered blade (prop) and the
  // simulation (mirrored into the entity so combat reads the right stats).
  // The starter is itself a generated level-1 roll.
  const starterWeapon = useConstant(() => generateWeapon('melee', 1));
  const [playerWeapon, setPlayerWeapon] = useState(starterWeapon);
  useEffect(() => { playerEntity.weapon = playerWeapon; }, [playerWeapon, playerEntity]);

  // Sim → React: deaths unmount mob views, pickups swap the equipped weapon,
  // the exit advances to the next area, damage keeps the HP readout live,
  // and player death soft-respawns at the area entry with full HP.
  useEffect(
    () =>
      onGameEvent((e) => {
        if (e.type === 'mobDied') setMobEntities((list) => list.filter((m) => m !== e.mob));
        else if (e.type === 'pickup') setPlayerWeapon(e.weapon);
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
      Digit1: () => setPlayerWeapon(randomWeapon(area)), // dev: reroll in-hand weapon
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
        <DamageNumbers />
        <Vision entity={playerEntity} />
        <Simulation map={map} />
      </Canvas>

      <div className="hud">
        <h1>sceggle</h1>
        <p className="sub">three.js · Miniplex · rot.js</p>
        <ul>
          <li><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move · <kbd>Mouse</kbd> aim</li>
          <li><kbd>Click</kbd> / <kbd>Space</kbd> attack (hold to keep attacking) — melee swings, ranged fires at the cursor</li>
          <li>Walk over drops to equip · reach the gold pad to leave the area</li>
          <li><kbd>1</kbd> dev: reroll the weapon in hand</li>
        </ul>
        <div className="stat">
          Area <b>{area}</b> · {mobEntities.length} mobs left · HP <b>{playerHp}</b>/{playerEntity.health!.max}
        </div>
        <div className="stat">
          In hand: <b>{playerWeapon.name}</b>{' '}
          <span>
            · dmg {playerWeapon.damage} · knockback {playerWeapon.knockback} · stagger{' '}
            {playerWeapon.stagger}s · rate {playerWeapon.rate}/s ·{' '}
            {playerWeapon.kind === 'melee' ? 'reach' : 'range'} {playerWeapon.reach}
            {playerWeapon.pierce ? ' · pierce' : ''}
          </span>
        </div>
        <div className="stat">
          You see 7 units. Mobs see 6 (their blue rings, shown while idle) and hear 4 —
          alerted mobs glow red.
        </div>
      </div>
    </>
  );
}
