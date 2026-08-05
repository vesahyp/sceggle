import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { CircleGeometry, Color, InstancedMesh, Object3D } from 'three';
import { zones } from '../ecs';

/** Instance capacity — a lobber spamming max-linger shells peaks around a
 *  dozen live zones; leave slack for mob lobbers stacking theirs. */
const MAX = 64;

const dummy = new Object3D();
const color = new Color();
const PLAYER_FIRE = '#ff8c42';
const MOB_FIRE = '#9bd35f';

// Flat disc on the ground; unit radius, scaled per zone.
const DISC = new CircleGeometry(1, 32);
DISC.rotateX(-Math.PI / 2);

/**
 * Ground-fire zones left by lob shells, rendered as one instanced flat disc
 * per zone, updated imperatively each frame (hot-loop rule). Warm gold-orange
 * for yours, sickly green for incoming — and a flicker (clock-driven, no RNG)
 * so it reads as burning, not painted.
 */
export function GroundZones() {
  const mesh = useRef<InstancedMesh>(null);

  useFrame(({ clock }) => {
    const m = mesh.current;
    if (!m) return;
    let i = 0;
    for (const z of zones) {
      if (i >= MAX) break;
      const s = z.zone;
      // Shrink out over the last half second so expiry reads on the ground.
      const fade = Math.min(1, s.life / 0.5);
      const flicker = 1 + 0.05 * Math.sin(clock.elapsedTime * 23 + i * 7);
      dummy.position.set(z.pos.x, 0.04, z.pos.z);
      dummy.scale.setScalar(Math.max(0.001, s.radius * fade * flicker));
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      m.setColorAt(i, color.set(s.faction === 'mob' ? MOB_FIRE : PLAYER_FIRE));
      i++;
    }
    m.count = i;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[DISC, undefined, MAX]} frustumCulled={false} renderOrder={5}>
      <meshBasicMaterial color="#ffffff" transparent opacity={0.4} depthWrite={false} />
    </instancedMesh>
  );
}
