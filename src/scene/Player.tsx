import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import {
  BoxGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Plane,
  RingGeometry,
  Vector3,
} from 'three';
import type { Entity } from '../ecs';
import type { WeaponDef } from '../weapons';
import { circleOverlapsWall, type GameMap } from '../worldmap';
import { keyboard } from '../input';
import { performAttack, meleeHitBand, bladeAngle, viewFx } from '../systems';
import { Weapon } from './Weapon';
import { HealthBar } from './HealthBar';

const SPEED = 5;
const BODY_Y = 0.65; // render height above the floor plane (sim is 2D)
const CAM_OFFSET = new Vector3(0, 12, 8); // top-down, tilted for a 2.5D feel

/** Projectiles spawn this far out along the aim (see systems.performAttack). */
const MUZZLE = 0.6;
/** Ground indicators float this high above the floor (in player-local space). */
const GROUND = -BODY_Y + 0.05;

// Scratch objects reused each frame (avoid per-frame allocation).
const groundPlane = new Plane(new Vector3(0, 1, 0), -BODY_Y);
const hitPoint = new Vector3();
const camTarget = new Vector3();

// Shared geometry for the ranged aim line: unit length along +Z, anchored at
// the origin so scale.z stretches it to the (wall-clipped) range.
const LINE_GEOM = new BoxGeometry(0.04, 0.01, 1);
LINE_GEOM.translate(0, 0, 0.5);
// End-of-range marker: a flat ring lying on the ground.
const END_GEOM = new RingGeometry(0.14, 0.2, 24);
END_GEOM.rotateX(-Math.PI / 2);

/**
 * Player: a capsule steered by held keys. The view writes input into
 * `entity.vel`; the simulation integrates it against the grid and the group
 * here just mirrors `entity.pos` each frame. Aim comes from the mouse
 * projected onto the ground. React stays out of the hot loop; only the
 * weapon *prop* is declarative.
 *
 * Range visualization tells the truth about the hit tests in systems.ts:
 * melee shows the actual hit sector (reach + body fudge, the real swing
 * arc), flashing bright on each swing; ranged shows an aim line from the
 * muzzle out to max range, clipped where a wall would stop the projectile,
 * with a ring marking the end.
 */
export function Player({ entity, weapon, map }: { entity: Entity; weapon: WeaponDef; map: GameMap }) {
  const group = useRef<Group>(null);
  const bodyMat = useRef<MeshStandardMaterial>(null);
  const statusPivot = useRef<Group>(null);
  const status = useRef<Group>(null);
  const weaponPivot = useRef<Group>(null);
  const aimPivot = useRef<Group>(null);
  const sectorMat = useRef<MeshBasicMaterial>(null);
  const line = useRef<Mesh>(null);
  const lineMat = useRef<MeshBasicMaterial>(null);
  const strike = useRef<Mesh>(null);
  const endRing = useRef<Mesh>(null);
  const attackHeld = useRef(false);
  const cooldown = useRef(0);
  const camera = useThree((s) => s.camera);
  const pointer = useThree((s) => s.pointer);
  const raycaster = useThree((s) => s.raycaster);

  // The true melee hit area: an annular band around the blade's sweep
  // radius (the same numbers stepAttacks tests against). The hole in
  // the middle is a long weapon's dead zone.
  const sectorGeom = useMemo(() => {
    const { inner, outer } = meleeHitBand(weapon.reach);
    const g = new RingGeometry(inner, outer, 40, 1,
      Math.PI / 2 - weapon.arc, weapon.arc * 2);
    g.rotateX(Math.PI / 2); // XY fan -> flat on the ground, centered on +Z
    return g;
  }, [weapon]);
  useEffect(() => () => sectorGeom.dispose(), [sectorGeom]);

  // Attack input: hold left mouse button or Space to attack continuously —
  // the weapon's `rate` (attacks/sec) sets the cadence via a cooldown in
  // useFrame below.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') attackHeld.current = e.type === 'keydown';
    };
    const onMouse = (e: MouseEvent) => {
      if (e.button !== 0) return;
      // Only the canvas arms an attack — clicking UI (the pack) must not
      // fire the gun. Releasing anywhere disarms.
      if (e.type === 'mousedown' && !(e.target instanceof HTMLCanvasElement)) return;
      attackHeld.current = e.type === 'mousedown';
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('mousedown', onMouse);
    window.addEventListener('mouseup', onMouse);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('mousedown', onMouse);
      window.removeEventListener('mouseup', onMouse);
    };
  }, []);

  useFrame(({ clock }, delta) => {
    const pos = entity.pos;
    const vel = entity.vel;
    if (!pos || !vel) return;

    // --- Movement (held keys → velocity; the sim integrates it) ---
    // During hit-stun the incoming knockback owns the velocity — no steering.
    if ((entity.stun ?? 0) <= 0) {
      let x = 0;
      let z = 0;
      if (keyboard.isDown('KeyW') || keyboard.isDown('ArrowUp')) z -= 1;
      if (keyboard.isDown('KeyS') || keyboard.isDown('ArrowDown')) z += 1;
      if (keyboard.isDown('KeyA') || keyboard.isDown('ArrowLeft')) x -= 1;
      if (keyboard.isDown('KeyD') || keyboard.isDown('ArrowRight')) x += 1;
      const len = Math.hypot(x, z) || 1;
      vel.x = (x / len) * SPEED;
      vel.z = (z / len) * SPEED;
    }

    // --- Aim (mouse projected onto the body-height ground plane) ---
    raycaster.setFromCamera(pointer, camera);
    if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
      const ax = hitPoint.x - pos.x;
      const az = hitPoint.z - pos.z;
      const al = Math.hypot(ax, az);
      if (al > 0.15) entity.aim = { x: ax / al, z: az / al };
    }

    // --- Attack cadence: while held, attack every 1/rate seconds ---
    cooldown.current -= delta;
    if (attackHeld.current && cooldown.current <= 0) {
      cooldown.current = 1 / weapon.rate;
      performAttack(); // melee: starts a sim swing · ranged: fires a bolt
    }

    // --- Weapon orientation + swing animation (driven by the SIM's swing
    //     state, so the blade is exactly where the hits land) ---
    const aim = entity.aim ?? { x: 0, z: 1 };
    const yaw = Math.atan2(aim.x, aim.z);
    const ms = entity.attack;
    if (weaponPivot.current) weaponPivot.current.rotation.y = yaw + bladeAngle(ms, weapon.arc);

    // --- Range indicators (aim-oriented, never sweeping) ---
    if (aimPivot.current) aimPivot.current.rotation.y = yaw;
    if (weapon.kind === 'melee') {
      // The strike bolt IS the hit: it appears at the sim's strike point and
      // rides the sweep (it's a child of the swinging pivot at reach).
      if (strike.current) strike.current.visible = !!ms && ms.t > ms.windup;
      // The sector only states area + readiness now: nearly gone while the
      // attack is unavailable (mid-attack or on cooldown), normal when ready.
      const opacity = !ms && cooldown.current <= 0 ? 0.28 : 0.06;
      if (sectorMat.current) sectorMat.current.opacity = opacity;
    } else {
      // Same readiness language as the melee sector: the line brightens over
      // the aim, goes dim while the mechanism re-arms, normal when ready.
      const lineOpacity = ms
        ? ms.t <= ms.windup ? 0.5 + 0.5 * (ms.t / ms.windup) : 0.15
        : cooldown.current > 0 ? 0.15 : 0.5;
      if (lineMat.current) lineMat.current.opacity = lineOpacity;
      // March along the aim like the projectile will, stopping at the first
      // wall — the line length IS how far this shot can actually fly.
      let range = weapon.reach;
      for (let d = 0; d < weapon.reach; d += 0.25) {
        if (circleOverlapsWall(map, pos.x + aim.x * (MUZZLE + d), pos.z + aim.z * (MUZZLE + d), weapon.hitRadius)) {
          range = d;
          break;
        }
      }
      if (line.current) line.current.scale.z = range;
      if (endRing.current) endRing.current.position.z = MUZZLE + range;
    }

    // --- Status readout (billboarded above the head) ---
    statusPivot.current?.quaternion.copy(camera.quaternion);
    if (status.current) status.current.visible = (entity.stun ?? 0) > 0;

    // --- Mirror sim position; camera follows (plus kill/blast trembles) ---
    if (bodyMat.current) bodyMat.current.emissive.set((entity.hitFlash ?? 0) > 0 ? '#ffffff' : '#000000');
    group.current?.position.set(pos.x, BODY_Y, pos.z);
    camTarget.set(pos.x + CAM_OFFSET.x, BODY_Y + CAM_OFFSET.y, pos.z + CAM_OFFSET.z);
    camera.position.lerp(camTarget, 0.1);
    camera.lookAt(pos.x, BODY_Y, pos.z);
    // The sim pumps viewFx.shake on kills and explosions; this is the one
    // consumer, so it also decays it. Incommensurate frequencies make the
    // jitter read as a rumble instead of a wobble.
    viewFx.shake = Math.max(0, viewFx.shake - delta * 1.6);
    if (viewFx.shake > 0.001) {
      const t = clock.elapsedTime;
      camera.position.x += Math.sin(t * 91) * viewFx.shake * 0.22;
      camera.position.z += Math.cos(t * 83) * viewFx.shake * 0.22;
    }
  });

  return (
    <group ref={group}>
      <mesh castShadow>
        <capsuleGeometry args={[0.35, 0.6, 8, 16]} />
        <meshStandardMaterial ref={bodyMat} color="#4ea1ff" />
      </mesh>
      {/* Pivot rotates to the aim and sweeps on swing. Ranged holds the gun
          mesh; melee holds no weapon — just the strike bolt out at reach,
          shown while the strike can land (same visual language as a shot,
          on an arc flight path instead of a line). */}
      <group ref={weaponPivot}>
        {weapon.kind === 'ranged' ? (
          <Weapon def={weapon} />
        ) : (
          <mesh ref={strike} position={[0, 0, weapon.reach]} visible={false}>
            <sphereGeometry args={[0.18, 8, 8]} />
            <meshBasicMaterial color="#ffd166" />
          </mesh>
        )}
      </group>
      <HealthBar entity={entity} />

      {/* Status effect readout while hit-stunned. The Text mounts visible
          (troika lays out on first draw); the plain group does the toggling. */}
      <group ref={statusPivot} position={[0, 1.37, 0]}>
        <group ref={status} visible={false}>
          <Text
            fontSize={0.18}
            color="#ff6b6b"
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.015}
            outlineColor="#10131a"
            renderOrder={999}
            material-depthTest={false}
          >
            stunned
          </Text>
        </group>
      </group>
      {/* Aim-only pivot for the range indicators (no swing sweep). */}
      <group ref={aimPivot} position={[0, GROUND, 0]}>
        {/* depthTest off + renderOrder below the health bars: readable over
            obstacles, so a wall-clipped line shows exactly where it stops. */}
        {weapon.kind === 'melee' ? (
          <mesh geometry={sectorGeom} renderOrder={990}>
            <meshBasicMaterial ref={sectorMat} color="#ffd166" transparent opacity={0.16} side={DoubleSide} depthWrite={false} depthTest={false} />
          </mesh>
        ) : (
          <>
            <mesh ref={line} geometry={LINE_GEOM} position={[0, 0, MUZZLE]} renderOrder={990}>
              <meshBasicMaterial ref={lineMat} color="#ffd166" transparent opacity={0.5} depthWrite={false} depthTest={false} />
            </mesh>
            <mesh ref={endRing} geometry={END_GEOM} renderOrder={991}>
              <meshBasicMaterial color="#ffd166" transparent opacity={0.65} side={DoubleSide} depthWrite={false} depthTest={false} />
            </mesh>
          </>
        )}
      </group>
    </group>
  );
}
