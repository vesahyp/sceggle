import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, InstancedMesh, Object3D } from 'three';
import { corpses } from '../ecs';

/** Instance capacity — a horde's worth of simultaneous deaths. */
const MAX = 128;

const dummy = new Object3D();
const color = new Color();

/**
 * Renders every corpse entity as one instanced mesh: bodies hop with the
 * killing shove, topple over while tumbling, then shrink away. Imperative
 * like Projectiles — deaths land without React churn, per the hot-loop rule.
 */
export function Corpses() {
  const mesh = useRef<InstancedMesh>(null);

  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    let i = 0;
    for (const c of corpses) {
      if (i >= MAX) break;
      const k = c.corpse.t / c.corpse.life;
      // A small ballistic hop, then settled on the ground.
      const hop = Math.max(0, Math.sin(Math.min(1, k * 1.6) * Math.PI)) * 0.5;
      dummy.position.set(c.pos.x, 0.22 + hop, c.pos.z);
      // Topple over the first quarter of the life while spinning flat.
      dummy.rotation.set(Math.min(1, k * 4) * (Math.PI / 2), c.corpse.spin * (1 + k * 2), 0);
      // Hold size, then evaporate over the last 30%.
      const fade = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      dummy.scale.setScalar(c.corpse.size * fade);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      m.setColorAt(i, color.set(c.corpse.tint).multiplyScalar(0.55));
      i++;
    }
    m.count = i;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, MAX]} frustumCulled={false}>
      <capsuleGeometry args={[0.28, 0.44, 4, 8]} />
      <meshStandardMaterial color="#ffffff" />
    </instancedMesh>
  );
}
