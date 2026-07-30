import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import { DoubleSide, Group, Mesh, MeshStandardMaterial, RingGeometry } from 'three';
import type { Entity } from '../ecs';
import { bladeAngle } from '../systems';
import { Weapon } from './Weapon';
import { HealthBar } from './HealthBar';

const BODY_Y = 0.65; // render height above the floor plane (sim is 2D)

/** Body tint per mob level (index level-1, clamped). */
const LEVEL_COLORS = ['#5fd35f', '#d3a75f', '#d35f5f'];

// Unit hearing ring, scaled per mob to its rolled hearing radius. Gold and
// omnidirectional, versus the blue directional vision cone: two senses, two
// shapes.
const HEARING_RING_GEOM = new RingGeometry(0.95, 1, 48);
HEARING_RING_GEOM.rotateX(-Math.PI / 2);

/**
 * A mob. Pure view: perception, AI, and knockback live in the simulation;
 * this just mirrors `entity.pos` into the mesh. Role shows as tint (spawn
 * roll) + size by level; an alerted mob glows faintly red, a lit exploder
 * strobes, a scalded mob flickers ember-orange. The held weapon comes from
 * `entity.weapon`, fixed at spawn.
 *
 * Readability layers are for NOTABLE mobs only (elites, spawners): a health
 * bar, a "staggered" label, and the idle sight ring. In a horde, chaff with
 * bars is just noise — one-hit mobs don't need a gauge.
 */
export function Mob({ entity }: { entity: Entity }) {
  const group = useRef<Group>(null);
  const mat = useRef<MeshStandardMaterial>(null);
  const weaponPivot = useRef<Group>(null);
  const strikePivot = useRef<Group>(null);
  const strike = useRef<Mesh>(null);
  const statusPivot = useRef<Group>(null);
  const status = useRef<Group>(null);
  const idleSenses = useRef<Group>(null);
  const conePivot = useRef<Group>(null);

  const level = entity.level ?? 1;
  const tint = entity.tint ?? LEVEL_COLORS[Math.min(level, LEVEL_COLORS.length) - 1];
  const scale = (1 + 0.18 * (level - 1)) * (entity.spawner ? 1.5 : 1);
  // Bars and status labels only where they carry information.
  const notable = level >= 2 || !!entity.spawner;

  // This mob's vision cone: exactly the sight distance and fov half-angle
  // the perception check tests, so what you sneak around is the truth.
  // Rolled per mob, fixed at spawn.
  const coneGeom = useMemo(() => {
    const sight = entity.brain?.sight ?? 6;
    const fov = entity.brain?.fov ?? 0.7;
    const g = new RingGeometry(0.3, sight, 36, 1, Math.PI / 2 - fov, fov * 2);
    g.rotateX(Math.PI / 2); // XY fan -> flat on the ground, centered on +Z
    return g;
  }, [entity]);
  useEffect(() => () => coneGeom.dispose(), [coneGeom]);

  useFrame(({ camera, clock }) => {
    if (entity.pos) group.current?.position.set(entity.pos.x, BODY_Y, entity.pos.z);
    if (mat.current) {
      // Priority: fuse strobe > just-hit white flash > windup telegraph >
      // scald flicker > alerted glow.
      const flash = (entity.hitFlash ?? 0) > 0;
      const winding = entity.attack && entity.attack.t <= entity.attack.windup;
      const strobing = entity.volatile?.lit && Math.sin(clock.elapsedTime * 45) > 0;
      const scalded = entity.burning && Math.sin(clock.elapsedTime * 18) > -0.3;
      mat.current.emissive.set(
        strobing
          ? '#ffffff'
          : flash
            ? '#ffffff'
            : winding
              ? '#a03030'
              : scalded
                ? '#b0521a'
                : entity.brain?.alerted
                  ? '#5a1414'
                  : '#000000',
      );
      mat.current.emissiveIntensity = flash || strobing ? 0.9 : 1;
    }
    if (idleSenses.current) idleSenses.current.visible = !entity.brain?.alerted;
    statusPivot.current?.quaternion.copy(camera.quaternion);
    if (status.current) status.current.visible = (entity.brain?.stagger ?? 0) > 0;

    // Aim pivots track the mob's aim and sweep on swing — the same math the
    // sim's shared swing mechanic uses, so the gun (ranged) and the strike
    // bolt (melee) are exactly where the hits are. The vision cone tracks
    // the plain aim (no swing sweep) — it's the gaze, not the blade.
    const aim = entity.aim ?? { x: 0, z: 1 };
    const pivotYaw = Math.atan2(aim.x, aim.z) + bladeAngle(entity.attack, entity.weapon?.arc ?? 0);
    if (weaponPivot.current) weaponPivot.current.rotation.y = pivotYaw;
    if (strikePivot.current) strikePivot.current.rotation.y = pivotYaw;
    if (conePivot.current) conePivot.current.rotation.y = Math.atan2(aim.x, aim.z);
    if (strike.current) {
      const a = entity.attack;
      strike.current.visible = !!a && entity.weapon?.kind === 'melee' && a.t > a.windup;
    }
  });

  return (
    <group ref={group} scale={scale}>
      <mesh castShadow>
        <capsuleGeometry args={[0.32, 0.5, 8, 16]} />
        <meshStandardMaterial ref={mat} color={tint} />
      </mesh>
      {/* Melee mobs hold no weapon mesh — their strike bolt (below, in
          unscaled space) is the attack visual, like a shot on an arc path. */}
      <group ref={weaponPivot}>
        {entity.weapon?.kind === 'ranged' && <Weapon def={entity.weapon} />}
      </group>

      {notable && <HealthBar entity={entity} />}

      {/* Status effect readout — billboarded above the bar. The Text mounts
          visible (troika lays out on first draw) and the plain parent group
          does the toggling. */}
      {notable && (
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
      )}

      {/* Vision cone and strike bolt. The compensating group undoes the
          level scale so both stay in true world units (the bolt sits at the
          weapon's real reach, where the sim tests hits; the cone spans the
          brain's real sight/fov, where perception tests the player). */}
      <group scale={1 / scale}>
        <group ref={idleSenses}>
          <group ref={conePivot}>
            <mesh geometry={coneGeom} position={[0, -BODY_Y + 0.03, 0]}>
              <meshBasicMaterial color="#7fb2e8" transparent opacity={0.12} side={DoubleSide} depthWrite={false} />
            </mesh>
          </group>
          <mesh
            geometry={HEARING_RING_GEOM}
            scale={entity.brain?.hearing ?? 3}
            position={[0, -BODY_Y + 0.025, 0]}
          >
            <meshBasicMaterial color="#e8c97f" transparent opacity={0.2} side={DoubleSide} depthWrite={false} />
          </mesh>
        </group>
        <group ref={strikePivot}>
          <mesh ref={strike} position={[0, 0, entity.weapon?.reach ?? 1]} visible={false}>
            <sphereGeometry args={[0.18, 8, 8]} />
            <meshBasicMaterial color="#ff6b6b" />
          </mesh>
        </group>
      </group>
    </group>
  );
}
