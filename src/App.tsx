import { useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrthographicCamera } from '@react-three/drei';
import { Physics } from '@react-three/rapier';
import { world } from './ecs';
import { WEAPONS, nextWeapon } from './weapons';
import { generateDungeon } from './dungeon';
import { useKeyboard } from './input';
import { performAttack } from './systems';
import { DungeonView, TILE } from './scene/Dungeon';
import { Player } from './scene/Player';
import { Mob } from './scene/Mob';

const Y = 0.65; // fixed body height above the floor plane

export default function App() {
  // Seeded dungeon → reproducible layout. Change the seed for a new floor.
  const dungeon = useMemo(() => generateDungeon(40, 32, 1337), []);

  // Spawn player on the first floor cell, goblin on a cell a few tiles away.
  const { playerStart, goblinStart } = useMemo(() => {
    const p = dungeon.floors[0];
    const g =
      dungeon.floors.find((c) => Math.hypot(c.x - p.x, c.z - p.z) > 5) ??
      dungeon.floors[dungeon.floors.length - 1];
    return {
      playerStart: [p.x * TILE, Y, p.z * TILE] as [number, number, number],
      goblinStart: [g.x * TILE, Y, g.z * TILE] as [number, number, number],
    };
  }, [dungeon]);

  // ECS entities — created once, live for the app's lifetime.
  const playerEntity = useMemo(() => world.add({ player: true as const, health: { current: 100, max: 100 } }), []);
  const goblinEntity = useMemo(() => world.add({ mob: true as const, health: { current: 10, max: 10 } }), []);
  useEffect(() => () => {
    world.remove(playerEntity);
    world.remove(goblinEntity);
  }, [playerEntity, goblinEntity]);

  // Reactive equipment state drives BOTH the rendered blade (prop) and the
  // simulation (mirrored into the entity so combat reads the right weight).
  const [playerWeapon, setPlayerWeapon] = useState(WEAPONS[1]); // longsword
  const [goblinWeapon, setGoblinWeapon] = useState(WEAPONS[0]); // dagger
  useEffect(() => { playerEntity.weapon = playerWeapon; }, [playerWeapon, playerEntity]);
  useEffect(() => { goblinEntity.weapon = goblinWeapon; }, [goblinWeapon, goblinEntity]);

  const handlers = useMemo(
    () => ({
      Digit1: () => setPlayerWeapon((w) => nextWeapon(w)),
      Digit2: () => setGoblinWeapon((w) => nextWeapon(w)),
      Space: () => performAttack(),
    }),
    [],
  );
  useKeyboard(handlers);

  return (
    <>
      <Canvas shadows>
        <color attach="background" args={['#0f1117']} />
        <OrthographicCamera makeDefault position={[0, 12, 8]} zoom={42} near={0.1} far={200} />

        <ambientLight intensity={0.5} />
        <directionalLight
          position={[10, 20, 10]}
          intensity={1.1}
          castShadow
          shadow-mapSize={[2048, 2048]}
        />

        <Physics gravity={[0, -9.81, 0]}>
          <DungeonView dungeon={dungeon} />
          <Player entity={playerEntity} weapon={playerWeapon} start={playerStart} />
          <Mob entity={goblinEntity} weapon={goblinWeapon} start={goblinStart} />
        </Physics>
      </Canvas>

      <div className="hud">
        <h1>sceggle</h1>
        <p className="sub">three.js · Rapier · Miniplex · rot.js</p>
        <ul>
          <li><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move</li>
          <li><kbd>Space</kbd> attack (knockback ∝ weapon weight)</li>
          <li><kbd>1</kbd> swap your weapon · <kbd>2</kbd> swap goblin's weapon</li>
        </ul>
        <div className="stat">Your weapon: <b>{playerWeapon.name}</b> <span>· weight {playerWeapon.weight}</span></div>
        <div className="stat">Goblin's weapon: <b>{goblinWeapon.name}</b></div>
      </div>
    </>
  );
}
