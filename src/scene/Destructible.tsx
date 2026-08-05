import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Mesh, MeshStandardMaterial } from 'three';
import type { Entity } from '../ecs';

/**
 * A crate or barrel: one breakable blocker on its stamped grid cell. Pure
 * view — HP and the cell live in the sim; this mirrors the hit flash and,
 * for barrels, pulses a warning glow. Individual meshes on purpose (not
 * Instances): they unmount one by one as they break, which fixed-at-mount
 * instance buffers can't do without ghosting.
 */
export function Destructible({ entity }: { entity: Entity }) {
  const mesh = useRef<Mesh>(null);
  const mat = useRef<MeshStandardMaterial>(null);
  const barrel = !!entity.destructible?.explosive;

  useFrame(({ clock }) => {
    // Fading flash + a little rattle-pop on hit — impact reads without a strobe.
    const hitK = Math.min(1, (entity.hitFlash ?? 0) / 0.2);
    if (mesh.current) mesh.current.scale.setScalar(1 + 0.12 * hitK);
    if (!mat.current) return;
    if (hitK > 0) {
      mat.current.emissive.set('#ffe8c4');
      mat.current.emissiveIntensity = 1.1 * hitK;
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
    <mesh ref={mesh} position={[pos.x, 0.45, pos.z]} castShadow>
      <cylinderGeometry args={[0.34, 0.38, 0.9, 12]} />
      <meshStandardMaterial ref={mat} color={entity.tint ?? '#c0392b'} />
    </mesh>
  ) : (
    <mesh ref={mesh} position={[pos.x, 0.42, pos.z]} castShadow>
      <boxGeometry args={[0.85, 0.85, 0.85]} />
      <meshStandardMaterial ref={mat} color={entity.tint ?? '#a8845c'} />
    </mesh>
  );
}
