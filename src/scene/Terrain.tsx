import { useEffect, useMemo } from 'react';
import { Instances, Instance } from '@react-three/drei';
import { BufferAttribute, Color, PlaneGeometry } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { TILE, KIND_RUIN, KIND_GRASS, KIND_CRATE, KIND_BARREL, type GameMap } from '../worldmap';

const RUIN_H = 1.9;

/** How far a wall darkens the floor it meets, at the contact corner. */
const CONTACT_AO = 0.55;

// Beveled unit blocks, shared across every instance of their kind. A chamfer
// catches the key light along each edge; a hard cube reads as one flat value
// per face however you light it. Rock is soft and worn, masonry is crisper,
// grass tufts are round enough to read as growth.
const ROCK_GEOM = new RoundedBoxGeometry(TILE, 1, TILE, 1, 0.09);
const RUIN_GEOM = new RoundedBoxGeometry(TILE, RUIN_H, TILE, 1, 0.05);
const GRASS_GEOM = new RoundedBoxGeometry(TILE * 0.95, 0.5, TILE * 0.95, 1, 0.18);

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

  // The floor, one vertex per grid corner, colored rather than textured.
  // Each corner darkens by how many of the four cells it touches are wall,
  // which bakes a contact shadow into every wall base and rock foot — the
  // cheat that stops terrain looking like objects dropped on a colored
  // rectangle. Computed once per map; free at runtime.
  const ground = useMemo(() => {
    const g = new PlaneGeometry(map.width * TILE, map.height * TILE, map.width, map.height);
    g.rotateX(-Math.PI / 2);
    const base = new Color(map.palette.ground);
    const c = new Color();
    const cols = new Float32Array((map.width + 1) * (map.height + 1) * 3);
    for (let j = 0; j <= map.height; j++) {
      for (let i = 0; i <= map.width; i++) {
        let walls = 0;
        for (let dz = -1; dz <= 0; dz++) {
          for (let dx = -1; dx <= 0; dx++) {
            const cx = i + dx;
            const cz = j + dz;
            // Off-grid counts as wall — the border ring is rock anyway, so
            // the map edge falls off like any other masonry.
            const solid =
              cx < 0 || cz < 0 || cx >= map.width || cz >= map.height || map.cells[cz * map.width + cx] === 1;
            if (solid) walls++;
          }
        }
        // Mottle on top of the AO so open ground isn't one dead flat value.
        c.copy(base).multiplyScalar((1 - CONTACT_AO * (walls / 4)) * (0.94 + cellHash(i, j) * 0.12));
        const o = (j * (map.width + 1) + i) * 3;
        cols[o] = c.r;
        cols[o + 1] = c.g;
        cols[o + 2] = c.b;
      }
    }
    g.setAttribute('color', new BufferAttribute(cols, 3));
    return g;
  }, [map]);
  useEffect(() => () => ground.dispose(), [ground]);

  return (
    <group>
      {/* Ground: one mesh spanning the whole grid, shaded per corner. */}
      <mesh
        geometry={ground}
        position={[((map.width - 1) / 2) * TILE, 0, ((map.height - 1) / 2) * TILE]}
        receiveShadow
      >
        <meshStandardMaterial vertexColors roughness={1} />
      </mesh>

      {/* Rocks (placeholder blocks). Keyed on the count: drei allocates
          instance buffers from the mount-time `limit`, so a bigger map must
          remount the pool or draws overflow the buffer. */}
      <Instances key={`rocks-${rocks.length}`} limit={rocks.length} castShadow receiveShadow>
        <primitive object={ROCK_GEOM} attach="geometry" />
        <meshStandardMaterial roughness={0.95} />
        {rocks.map((r, i) => (
          <Instance key={i} position={[r.x * TILE, r.h / 2, r.z * TILE]} scale={[1, r.h, 1]} color={r.color} />
        ))}
      </Instances>

      {/* Ruin walls: built structure — taller, uniform, masonry-tinted. */}
      {ruins.length > 0 && (
        <Instances key={`ruins-${ruins.length}`} limit={ruins.length} castShadow receiveShadow>
          <primitive object={RUIN_GEOM} attach="geometry" />
          <meshStandardMaterial color={map.palette.ruin} roughness={0.85} />
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
          <primitive object={GRASS_GEOM} attach="geometry" />
          <meshStandardMaterial color={map.palette.grass} roughness={1} />
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
