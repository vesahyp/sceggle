import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { MeshStandardMaterial } from 'three';
import type { Entity } from '../ecs';

/**
 * A crate or barrel: one breakable blocker on its stamped grid cell. Pure
 * view — HP and the cell live in the sim; this mirrors the hit flash and,
 * for barrels, pulses a warning glow. Individual meshes on purpose (not
 * Instances): they unmount one by one as they break, which fixed-at-mount
 * instance buffers can't do without ghosting.
 */
export function Destructible({ entity }: { entity: Entity }) {
  const mat = useRef<MeshStandardMaterial>(null);
  const barrel = !!entity.destructible?.explosive;

  useFrame(({ clock }) => {
    if (!mat.current) return;
    if ((entity.hitFlash ?? 0) > 0) {
      mat.current.emissive.set('#ffffff');
      mat.current.emissiveIntensity = 0.9;
    } else if (barrel) {
      // A slow smoulder: reads as "this one goes off", no RNG involved.
      mat.current.emissive.set('#ff3b1f');
      mat.current.emissiveIntensity = 0.25 + 0.15 * Math.sin(clock.elapsedTime * 6);
    } else {
      mat.current.emissive.set('#000000');
      mat.current.emissiveIntensity = 1;
    }
  });

  const pos = entity.pos ?? { x: 0, z: 0 };
  return barrel ? (
    <mesh position={[pos.x, 0.45, pos.z]} castShadow>
      <cylinderGeometry args={[0.34, 0.38, 0.9, 12]} />
      <meshStandardMaterial ref={mat} color={entity.tint ?? '#c0392b'} />
    </mesh>
  ) : (
    <mesh position={[pos.x, 0.42, pos.z]} castShadow>
      <boxGeometry args={[0.85, 0.85, 0.85]} />
      <meshStandardMaterial ref={mat} color={entity.tint ?? '#a8845c'} />
    </mesh>
  );
}
