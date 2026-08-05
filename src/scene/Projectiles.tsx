import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, InstancedMesh, Object3D } from 'three';
import { projectiles } from '../ecs';

/** Instance capacity — multishot, splits, and a field of sniper mobs add up. */
const MAX = 256;
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
      // Lobbed shells arc: a render-only parabola over the flight fraction
      // (the sim stays 2D — this is why they clear walls visually too).
      let y = BODY_Y;
      if (p.projectile.lob && p.projectile.maxRange > 0) {
        const t = Math.min(1, p.projectile.traveled / p.projectile.maxRange);
        y += Math.min(3.2, p.projectile.maxRange * 0.35) * 4 * t * (1 - t);
      }
      dummy.position.set(p.pos.x, y, p.pos.z);
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
