import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, Color, InstancedMesh, Object3D } from 'three';
import type { Entity } from '../ecs';

/** A stride's worth of ground per footfall (at player speed ~3.5 steps/s). */
const STRIDE = 0.85;
const LIFE = 0.55;
const MAX = 12;
/** Speeds bounding the loudness ramp: at or below WALK a footfall looks like
 *  the quiet baseline; at RUN (full player speed) it lands bigger and
 *  brighter. Touch is analog, so the whole range is reachable. */
const WALK_SPEED = 2.5;
const RUN_SPEED = 5;

// Lay the ring flat via per-instance rotation (the JSX geometry is XY).
const dummy = new Object3D();
dummy.rotation.x = -Math.PI / 2;
const color = new Color();

/**
 * Footstep ripples: while the player moves, every STRIDE of ground covered
 * plants a footfall — alternating slightly left/right of the direction of
 * travel — that expands as a fading ring, bigger and brighter the faster
 * the foot was moving when it landed. It's the "I am making noise"
 * readout opposite the mobs' hearing rings (one day it will BE the noise
 * system; today it's honest theater). Instanced + additive so a sprint's
 * trail is one draw call of soft glows.
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
        const loud = Math.min(1, Math.max(0, (speed - WALK_SPEED) / (RUN_SPEED - WALK_SPEED)));
        ripples.current.push({ x: pos.x + ox, z: pos.z + oz, t: 0, loud });
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
