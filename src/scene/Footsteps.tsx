import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, Color, InstancedMesh, Object3D } from 'three';
import type { Entity } from '../ecs';
import { moveLoudness } from '../systems';

/** A stride's worth of ground per footfall (at player speed ~3.5 steps/s). */
const STRIDE = 0.85;
const LIFE = 0.55;
const MAX = 12;

// Lay the ring flat via per-instance rotation (the JSX geometry is XY).
const dummy = new Object3D();
dummy.rotation.x = -Math.PI / 2;
const color = new Color();

/**
 * Footstep ripples: while the player moves, every STRIDE of ground covered
 * plants a footfall — alternating slightly left/right of the direction of
 * travel — that expands as a fading ring, bigger and brighter the faster
 * the foot was moving when it landed.
 *
 * The size is not decoration any more: it comes from `moveLoudness`, the
 * same curve perception scales every mob's hearing ring by. The ripple you
 * see IS the noise they hear. Instanced + additive so a sprint's trail is
 * one draw call of soft glows.
 */
export function Footsteps({ entity }: { entity: Entity }) {
  const mesh = useRef<InstancedMesh>(null);
  const ripples = useRef<Array<{ x: number; z: number; t: number; loud: number }>>([]);
  const traveled = useRef(0);
  const side = useRef(1);

  useFrame((_, delta) => {
    const pos = entity.pos;
    const vel = entity.vel;
    const m = mesh.current;
    if (!pos || !vel || !m) return;

    const speed = Math.hypot(vel.x, vel.z);
    if (speed > 0.5) {
      traveled.current += speed * delta;
      if (traveled.current >= STRIDE) {
        traveled.current -= STRIDE;
        side.current = -side.current;
        // Feet land beside the line of travel, not on it.
        const ox = (-vel.z / speed) * 0.13 * side.current;
        const oz = (vel.x / speed) * 0.13 * side.current;
        ripples.current.push({ x: pos.x + ox, z: pos.z + oz, t: 0, loud: moveLoudness(speed) });
        if (ripples.current.length > MAX) ripples.current.shift();
      }
    } else {
      // Standing still is quiet — and the next first step lands at once.
      traveled.current = STRIDE * 0.75;
    }

    for (const r of ripples.current) r.t += delta;
    ripples.current = ripples.current.filter((r) => r.t < LIFE);

    let i = 0;
    for (const r of ripples.current) {
      const k = r.t / LIFE;
      dummy.position.set(r.x, 0.04, r.z);
      dummy.scale.setScalar(0.2 + k * (1.05 + r.loud * 0.85));
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      // Additive blending: fading the color to black IS the fade-out.
      m.setColorAt(i, color.set('#8fa3c8').multiplyScalar((0.5 + r.loud * 0.35) * (1 - k)));
      i++;
    }
    m.count = i;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, MAX]} frustumCulled={false}>
      <ringGeometry args={[0.78, 1, 32]} />
      <meshBasicMaterial blending={AdditiveBlending} transparent depthWrite={false} />
    </instancedMesh>
  );
}
