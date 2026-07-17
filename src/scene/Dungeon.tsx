import { useMemo } from 'react';
import { Instances, Instance } from '@react-three/drei';
import { RigidBody, CuboidCollider } from '@react-three/rapier';
import type { Dungeon } from '../dungeon';

export const TILE = 1; // world units per grid cell
const WALL_H = 1.2;

/**
 * Renders the dungeon: instanced floor tiles + instanced wall blocks (one draw
 * call each), and a single fixed Rapier body holding one cuboid collider per
 * wall cell. Visuals and colliders are generated from the same grid but kept
 * independent — the classic render/physics split.
 */
export function DungeonView({ dungeon }: { dungeon: Dungeon }) {
  const { floors, walls } = useMemo(() => {
    const floorCells: Array<[number, number]> = [];
    const wallCells: Array<[number, number]> = [];
    for (let z = 0; z < dungeon.height; z++) {
      for (let x = 0; x < dungeon.width; x++) {
        if (dungeon.cells[z * dungeon.width + x] === 1) {
          // Only render walls adjacent to a floor — skip solid interior rock.
          if (touchesFloor(dungeon, x, z)) wallCells.push([x, z]);
        } else {
          floorCells.push([x, z]);
        }
      }
    }
    return { floors: floorCells, walls: wallCells };
  }, [dungeon]);

  return (
    <group>
      {/* Floor */}
      <Instances limit={floors.length} castShadow={false} receiveShadow>
        <boxGeometry args={[TILE, 0.2, TILE]} />
        <meshStandardMaterial color="#2b2f3a" />
        {floors.map(([x, z], i) => (
          <Instance key={i} position={[x * TILE, -0.1, z * TILE]} />
        ))}
      </Instances>

      {/* Walls (visual) */}
      <Instances limit={walls.length} castShadow receiveShadow>
        <boxGeometry args={[TILE, WALL_H, TILE]} />
        <meshStandardMaterial color="#3d4456" />
        {walls.map(([x, z], i) => (
          <Instance key={i} position={[x * TILE, WALL_H / 2, z * TILE]} />
        ))}
      </Instances>

      {/* Walls (physics) — one fixed body, many colliders */}
      <RigidBody type="fixed" colliders={false}>
        {walls.map(([x, z], i) => (
          <CuboidCollider
            key={i}
            args={[TILE / 2, WALL_H / 2, TILE / 2]}
            position={[x * TILE, WALL_H / 2, z * TILE]}
          />
        ))}
      </RigidBody>
    </group>
  );
}

function touchesFloor(dungeon: Dungeon, x: number, z: number): boolean {
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dungeon.isWall(x + dx, z + dz)) return true;
    }
  }
  return false;
}
