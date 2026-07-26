import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, InstancedMesh, Object3D } from 'three';
import { projectiles } from '../ecs';

/** Instance capacity — plenty at one shot per swing. */
const MAX = 64;
const BODY_Y = 0.65;

const dummy = new Object3D();
const color = new Color();
const PLAYER_SHOT = '#ffd166';
const MOB_SHOT = '#ff6b6b';

/**
 * Renders every projectile entity as one instanced mesh, updated imperatively
 * each frame — zero React churn per shot, per the hot-loop rule.
 */
export function Projectiles() {
  const mesh = useRef<InstancedMesh>(null);

  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    let i = 0;
    for (const p of projectiles) {
      if (i >= MAX) break;
      dummy.position.set(p.pos.x, BODY_Y, p.pos.z);
      // The sphere geometry is unit-radius 0.12 — scale to the hit radius.
      dummy.scale.setScalar((p.radius ?? 0.12) / 0.12);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      // Gold = yours, red = incoming.
      m.setColorAt(i, color.set(p.projectile.faction === 'mob' ? MOB_SHOT : PLAYER_SHOT));
      i++;
    }
    m.count = i;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, MAX]} frustumCulled={false}>
      <sphereGeometry args={[0.12, 8, 8]} />
      {/* Unlit white base so the per-instance faction color shows saturated. */}
      <meshBasicMaterial color="#ffffff" />
    </instancedMesh>
  );
}
