import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, Group, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';
import type { Entity } from '../ecs';

const BAR_W = 0.7;
const BAR_H = 0.09;
const BAR_PAD = 0.04;
const FULL = new Color('#5fd35f');
const EMPTY = new Color('#d35f5f');

// Shared geometries — every bar reuses these. The fill quad is left-anchored
// (translated so its left edge sits at the origin), which lets scale.x
// shrink it toward the left like a draining gauge.
const BG_GEOM = new PlaneGeometry(BAR_W + BAR_PAD, BAR_H + BAR_PAD);
const FILL_GEOM = new PlaneGeometry(1, BAR_H);
FILL_GEOM.translate(0.5, 0, 0);

/**
 * A billboarded health bar floating above an entity, reading
 * `entity.health` each frame: fill drains left and lerps green → red.
 * Depth-test off so obstacles never hide it. Used by mobs and the player.
 */
export function HealthBar({ entity, y = 1.15 }: { entity: Entity; y?: number }) {
  const bar = useRef<Group>(null);
  const fill = useRef<Mesh>(null);
  const fillMat = useRef<MeshBasicMaterial>(null);

  useFrame(({ camera }) => {
    const h = entity.health;
    const b = bar.current;
    if (!b || !h) return;
    b.quaternion.copy(camera.quaternion); // face the camera
    const pct = Math.max(h.current / h.max, 0);
    if (fill.current) fill.current.scale.x = BAR_W * pct;
    fillMat.current?.color.lerpColors(EMPTY, FULL, pct);
  });

  return (
    <group ref={bar} position={[0, y, 0]}>
      <mesh geometry={BG_GEOM} renderOrder={998}>
        <meshBasicMaterial color="#10131a" transparent opacity={0.85} depthTest={false} />
      </mesh>
      <mesh ref={fill} geometry={FILL_GEOM} position={[-BAR_W / 2, 0, 0]} renderOrder={999}>
        <meshBasicMaterial ref={fillMat} depthTest={false} />
      </mesh>
    </group>
  );
}
