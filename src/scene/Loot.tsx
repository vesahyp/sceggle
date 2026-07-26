import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, InstancedMesh, Object3D } from 'three';
import { loots } from '../ecs';

/** Instance capacity — one drop per mob, so this is generous. */
const MAX = 64;

const dummy = new Object3D();
const color = new Color();

/**
 * Renders every loot entity as one instanced mesh, tinted per-instance to the
 * dropped weapon's color and slowly spinning so drops read against the
 * ground. Imperative like Projectiles — drops appear/vanish without React.
 */
export function Loot() {
  const mesh = useRef<InstancedMesh>(null);

  useFrame(({ clock }) => {
    const m = mesh.current;
    if (!m) return;
    let i = 0;
    for (const item of loots) {
      if (i >= MAX) break;
      dummy.position.set(item.pos.x, 0.25, item.pos.z);
      dummy.rotation.set(0, clock.elapsedTime * 1.5, 0);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      m.setColorAt(i, color.set(item.loot.weapon.color));
      i++;
    }
    m.count = i;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, MAX]} frustumCulled={false}>
      <boxGeometry args={[0.35, 0.35, 0.35]} />
      <meshStandardMaterial metalness={0.4} roughness={0.4} />
    </instancedMesh>
  );
}
