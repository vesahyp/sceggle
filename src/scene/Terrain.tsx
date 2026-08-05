import { useMemo } from 'react';
import { Instances, Instance } from '@react-three/drei';
import { Color } from 'three';
import { TILE, KIND_RUIN, KIND_GRASS, KIND_CRATE, KIND_BARREL, type GameMap } from '../worldmap';

const RUIN_H = 1.9;

/** Deterministic per-cell jitter in [0, 1) — no RNG stream draw, so the
 *  renderer never perturbs sim determinism. */
const cellHash = (x: number, z: number) => {
  const v = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return v - Math.floor(v);
};

/**
 * Renders the overworld from the generated grid: one ground slab in the
 * area's palette, rock masses as height/shade-jittered boulder blocks, and
 * ruin walls as taller uniform masonry — so terrain and built structure
 * read differently at a glance. Collision is handled by the kinematic sim
 * reading the same grid — the renderer only reflects it.
 */
export function Terrain({ map }: { map: GameMap }) {
  const { rocks, ruins, grass } = useMemo(() => {
    const rocks: Array<{ x: number; z: number; h: number; color: Color }> = [];
    const ruins: Array<[number, number]> = [];
    const grass: Array<[number, number]> = [];
    const base = new Color(map.palette.rock);
    for (let z = 0; z < map.height; z++) {
      for (let x = 0; x < map.width; x++) {
        const i = z * map.width + x;
        if (map.cells[i] !== 1) {
          if (map.kinds[i] === KIND_GRASS) grass.push([x, z]);
          continue;
        }
        if (map.kinds[i] === KIND_RUIN) {
          ruins.push([x, z]);
        } else if (map.kinds[i] !== KIND_CRATE && map.kinds[i] !== KIND_BARREL) {
          // Destructibles render as their own entities, never as boulders.
          const h = cellHash(x, z);
          rocks.push({ x, z, h: 0.7 + h * 0.9, color: base.clone().multiplyScalar(0.8 + h * 0.4) });
        }
      }
    }
    return { rocks, ruins, grass };
  }, [map]);

  return (
    <group>
      {/* Ground: one slab spanning the whole grid. */}
      <mesh position={[((map.width - 1) / 2) * TILE, -0.1, ((map.height - 1) / 2) * TILE]} receiveShadow>
        <boxGeometry args={[map.width * TILE, 0.2, map.height * TILE]} />
        <meshStandardMaterial color={map.palette.ground} />
      </mesh>

      {/* Rocks (placeholder blocks). Keyed on the count: drei allocates
          instance buffers from the mount-time `limit`, so a bigger map must
          remount the pool or draws overflow the buffer. */}
      <Instances key={`rocks-${rocks.length}`} limit={rocks.length} castShadow receiveShadow>
        <boxGeometry args={[TILE, 1, TILE]} />
        <meshStandardMaterial />
        {rocks.map((r, i) => (
          <Instance key={i} position={[r.x * TILE, r.h / 2, r.z * TILE]} scale={[1, r.h, 1]} color={r.color} />
        ))}
      </Instances>

      {/* Ruin walls: built structure — taller, uniform, masonry-tinted. */}
      {ruins.length > 0 && (
        <Instances key={`ruins-${ruins.length}`} limit={ruins.length} castShadow receiveShadow>
          <boxGeometry args={[TILE, RUIN_H, TILE]} />
          <meshStandardMaterial color={map.palette.ruin} />
          {ruins.map(([x, z], i) => (
            <Instance key={i} position={[x * TILE, RUIN_H / 2, z * TILE]} />
          ))}
        </Instances>
      )}

      {/* Grass tufts: walkable concealment — stand inside and mob eyes fail.
          Squat rounded blocks, jittered per cell (cellHash, no RNG draws) so
          patches read as growth, not tiles. No shadows: a bush shouldn't
          darken whoever hides in it. */}
      {grass.length > 0 && (
        <Instances key={`grass-${grass.length}`} limit={grass.length} receiveShadow>
          <boxGeometry args={[TILE * 0.95, 0.5, TILE * 0.95]} />
          <meshStandardMaterial color={map.palette.grass} />
          {grass.map(([x, z], i) => {
            const h1 = cellHash(x, z);
            const h2 = cellHash(x + 31, z + 17);
            return (
              <Instance
                key={i}
                position={[x * TILE + (h2 - 0.5) * 0.25, 0.25 * (0.8 + h1 * 0.5), z * TILE + (h1 - 0.5) * 0.25]}
                scale={[0.85 + h2 * 0.3, 0.8 + h1 * 0.5, 0.85 + h1 * 0.3]}
                rotation={[0, h2 * 0.6, 0]}
              />
            );
          })}
        </Instances>
      )}

      {/* Exit pad: step on it to leave the area. */}
      <mesh position={[map.exit.x * TILE, 0.02, map.exit.z * TILE]}>
        <boxGeometry args={[TILE * 1.2, 0.08, TILE * 1.2]} />
        <meshStandardMaterial color="#ffd166" emissive="#8a5a00" />
      </mesh>
    </group>
  );
}
