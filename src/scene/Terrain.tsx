import { useMemo } from 'react';
import { Instances, Instance } from '@react-three/drei';
import { TILE, type GameMap } from '../worldmap';

const OBSTACLE_H = 1.2;

/**
 * Renders the overworld: one ground slab plus instanced obstacle blocks (a
 * single draw call). Collision is handled by the kinematic sim reading the
 * same grid — the renderer only reflects it.
 */
export function Terrain({ map }: { map: GameMap }) {
  const solids = useMemo(() => {
    const cells: Array<[number, number]> = [];
    for (let z = 0; z < map.height; z++) {
      for (let x = 0; x < map.width; x++) {
        if (map.cells[z * map.width + x] === 1) cells.push([x, z]);
      }
    }
    return cells;
  }, [map]);

  return (
    <group>
      {/* Ground: one slab spanning the whole grid. */}
      <mesh position={[((map.width - 1) / 2) * TILE, -0.1, ((map.height - 1) / 2) * TILE]} receiveShadow>
        <boxGeometry args={[map.width * TILE, 0.2, map.height * TILE]} />
        <meshStandardMaterial color="#2b2f3a" />
      </mesh>

      {/* Obstacles (rocks/ruins — placeholder blocks). Keyed on the count:
          drei allocates instance buffers from the mount-time `limit`, so a
          bigger map must remount the pool or draws overflow the buffer. */}
      <Instances key={`solids-${solids.length}`} limit={solids.length} castShadow receiveShadow>
        <boxGeometry args={[TILE, OBSTACLE_H, TILE]} />
        <meshStandardMaterial color="#3d4456" />
        {solids.map(([x, z], i) => (
          <Instance key={i} position={[x * TILE, OBSTACLE_H / 2, z * TILE]} />
        ))}
      </Instances>

      {/* Exit pad: step on it to leave the area. */}
      <mesh position={[map.exit.x * TILE, 0.02, map.exit.z * TILE]}>
        <boxGeometry args={[TILE * 1.2, 0.08, TILE * 1.2]} />
        <meshStandardMaterial color="#ffd166" emissive="#8a5a00" />
      </mesh>
    </group>
  );
}
