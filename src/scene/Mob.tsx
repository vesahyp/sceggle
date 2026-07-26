import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import { Group, Mesh, MeshStandardMaterial, RingGeometry } from 'three';
import type { Entity } from '../ecs';
import { SWING_HALF_ARC_RAD } from '../systems';
import { Weapon } from './Weapon';
import { HealthBar } from './HealthBar';

const BODY_Y = 0.65; // render height above the floor plane (sim is 2D)

/** Body tint per mob level (index level-1, clamped). */
const LEVEL_COLORS = ['#5fd35f', '#d3a75f', '#d35f5f'];

// Sight-range ring, flat on the ground ("for now" debug readability — every
// brain currently sees 6; keep in step with App.spawnMobs).
const SIGHT_RANGE = 6;
const SIGHT_RING_GEOM = new RingGeometry(SIGHT_RANGE - 0.06, SIGHT_RANGE, 64);
SIGHT_RING_GEOM.rotateX(-Math.PI / 2);

/**
 * A mob. Pure view: perception, AI, and knockback live in the simulation;
 * this just mirrors `entity.pos` into the mesh. Level shows as tint + size,
 * and an alerted mob glows faintly red so the sight/hearing system is
 * readable at a glance. The held weapon comes from `entity.weapon`, fixed
 * at spawn.
 *
 * Readability layers: a health bar floats above every mob, a "staggered"
 * status label appears above it while the mob is stunned, and an idle mob
 * shows its sight range as a ground ring (hidden once alerted — it's
 * already coming).
 */
export function Mob({ entity }: { entity: Entity }) {
  const group = useRef<Group>(null);
  const mat = useRef<MeshStandardMaterial>(null);
  const weaponPivot = useRef<Group>(null);
  const statusPivot = useRef<Group>(null);
  const status = useRef<Group>(null);
  const ring = useRef<Mesh>(null);

  const level = entity.level ?? 1;
  const tint = LEVEL_COLORS[Math.min(level, LEVEL_COLORS.length) - 1];
  const scale = 1 + 0.18 * (level - 1);

  useFrame(({ camera }) => {
    if (entity.pos) group.current?.position.set(entity.pos.x, BODY_Y, entity.pos.z);
    if (mat.current) {
      // Priority: just-hit white flash > alerted glow > nothing.
      const flash = (entity.hitFlash ?? 0) > 0;
      mat.current.emissive.set(flash ? '#ffffff' : entity.brain?.alerted ? '#5a1414' : '#000000');
      mat.current.emissiveIntensity = flash ? 0.9 : 1;
    }
    if (ring.current) ring.current.visible = !entity.brain?.alerted;
    statusPivot.current?.quaternion.copy(camera.quaternion);
    if (status.current) status.current.visible = (entity.brain?.stagger ?? 0) > 0;

    // Weapon tracks the mob's aim and sweeps on swing — the same math the
    // sim's shared swing mechanic uses, so the blade is where the hits are.
    if (weaponPivot.current) {
      const aim = entity.aim ?? { x: 0, z: 1 };
      const ms = entity.melee;
      const swingAngle = ms ? (0.5 - ms.t / ms.duration) * 2 * SWING_HALF_ARC_RAD : 0;
      weaponPivot.current.rotation.y = Math.atan2(aim.x, aim.z) + swingAngle;
    }
  });

  return (
    <group ref={group} scale={scale}>
      <mesh castShadow>
        <capsuleGeometry args={[0.32, 0.5, 8, 16]} />
        <meshStandardMaterial ref={mat} color={tint} />
      </mesh>
      <group ref={weaponPivot}>{entity.weapon && <Weapon def={entity.weapon} />}</group>

      <HealthBar entity={entity} />

      {/* Status effect readout — billboarded above the bar. The Text mounts
          visible (troika lays out on first draw) and the plain parent group
          does the toggling. */}
      <group ref={statusPivot} position={[0, 1.37, 0]}>
        <group ref={status} visible={false}>
          <Text
            fontSize={0.18}
            color="#ffd166"
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.015}
            outlineColor="#10131a"
            renderOrder={999}
            material-depthTest={false}
          >
            staggered
          </Text>
        </group>
      </group>

      {/* Sight range, on the ground. The compensating group undoes the
          level scale so the ring stays in true world units. */}
      <group scale={1 / scale}>
        <mesh ref={ring} geometry={SIGHT_RING_GEOM} position={[0, -BODY_Y + 0.03, 0]}>
          <meshBasicMaterial color="#7fb2e8" transparent opacity={0.3} depthWrite={false} />
        </mesh>
      </group>
    </group>
  );
}
