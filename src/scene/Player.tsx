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
import { mobs, type Entity } from '../ecs';
import type { WeaponDef } from '../weapons';
import { circleOverlapsWall, worldToCell, type GameMap } from '../worldmap';
import { keyboard } from '../input';
import { touch } from '../touch';
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

/**
 * Aim assist for the touch stick: if a live mob sits within ~10° of the
 * stick direction (and inside weapon range), snap the aim onto it. Small
 * enough that pointing between two mobs stays your choice; enough that a
 * thumb doesn't whiff a straight shot. Mouse aim never gets it.
 */
function assistAim(
  pos: { x: number; z: number },
  ax: number,
  az: number,
  range: number,
): { x: number; z: number } {
  let bestDot = Math.cos(0.18);
  let best: { x: number; z: number } | null = null;
  for (const m of mobs) {
    const dx = m.pos.x - pos.x;
    const dz = m.pos.z - pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.5 || d > range) continue;
    const dot = (ax * dx + az * dz) / d;
    if (dot > bestDot) {
      bestDot = dot;
      best = { x: dx / d, z: dz / d };
    }
  }
  return best ?? { x: ax, z: az };
}

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
  const body = useRef<Mesh>(null);
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

    // --- Movement (touch stick or held keys → velocity; the sim
    //     integrates it). Touch is analog: half deflection walks. During
    //     hit-stun the incoming knockback owns the velocity — no steering.
    if ((entity.stun ?? 0) <= 0) {
      if (touch.move.active) {
        vel.x = touch.move.x * SPEED;
        vel.z = touch.move.z * SPEED;
      } else {
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
    }

    // --- Aim: the aim stick when a thumb is down (with a nudge of aim
    //     assist — thumb precision isn't mouse precision), else the mouse
    //     projected onto the body-height ground plane. ---
    if (touch.aim.active) {
      entity.aim = assistAim(pos, touch.aim.x, touch.aim.z, weapon.reach);
      // No cursor on touch — lobs fly to full reach.
      entity.aimDist = weapon.reach;
    } else if (!touch.used) {
      raycaster.setFromCamera(pointer, camera);
      if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
        const ax = hitPoint.x - pos.x;
        const az = hitPoint.z - pos.z;
        const al = Math.hypot(ax, az);
        if (al > 0.15) {
          entity.aim = { x: ax / al, z: az / al };
          // Lob shells land AT the cursor (clamped to reach in the sim).
          entity.aimDist = al;
        }
      }
    }

    // --- Attack cadence: while held (button, key, or aim-stick
    //     deflection), attack every 1/rate seconds ---
    cooldown.current -= delta;
    if ((attackHeld.current || touch.aim.fire) && cooldown.current <= 0) {
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
      let range = weapon.reach;
      if (weapon.delivery === 'lob') {
        // A lob flies over walls and lands at the cursor: the ring marks the
        // landing point, nothing clips the line.
        range = Math.max(0.3, Math.min(weapon.reach, entity.aimDist ?? weapon.reach) - MUZZLE);
      } else {
        // March along the aim like the projectile will, stopping at the
        // first wall — the line length IS how far this shot can actually fly.
        for (let d = 0; d < weapon.reach; d += 0.25) {
          if (circleOverlapsWall(map, pos.x + aim.x * (MUZZLE + d), pos.z + aim.z * (MUZZLE + d), weapon.hitRadius)) {
            range = d;
            break;
          }
        }
      }
      if (line.current) line.current.scale.z = range;
      if (endRing.current) {
        endRing.current.position.z = MUZZLE + range;
        // Landing ring swells to the blast radius so a lobber reads its
        // splash before committing.
        const ringScale = weapon.delivery === 'lob' && weapon.blastRadius > 0 ? weapon.blastRadius / 0.17 : 1;
        endRing.current.scale.setScalar(ringScale);
      }
    }

    // --- Status readout (billboarded above the head) ---
    statusPivot.current?.quaternion.copy(camera.quaternion);
    if (status.current) status.current.visible = (entity.stun ?? 0) > 0;

    // --- Body life: gait bob + travel lean + hit squash-flash (all
    //     render-only, on the body mesh so indicators stay planted) ---
    const hitK = Math.min(1, (entity.hitFlash ?? 0) / 0.2);
    if (body.current) {
      const move = Math.min(1, Math.hypot(vel.x, vel.z) / SPEED);
      body.current.position.y = Math.abs(Math.sin(clock.elapsedTime * 10)) * 0.1 * move;
      body.current.rotation.x = (vel.z / SPEED) * 0.14;
      body.current.rotation.z = -(vel.x / SPEED) * 0.14;
      body.current.scale.set(1 + 0.24 * hitK, 1 - 0.28 * hitK, 1 + 0.24 * hitK);
    }
    if (bodyMat.current) {
      bodyMat.current.emissive.set(hitK > 0 ? '#ffe8c4' : '#000000');
      bodyMat.current.emissiveIntensity = hitK > 0 ? 1.1 * hitK : 1;
    }
    // Concealment tell: faded = in grass and unseen by mob eyes (the same
    // condition the perception gate tests).
    const hidden = map.isGrass(worldToCell(pos.x), worldToCell(pos.z)) && (entity.reveal ?? 0) <= 0;
    if (bodyMat.current) bodyMat.current.opacity = hidden ? 0.4 : 1;
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
      <mesh ref={body} castShadow>
        <capsuleGeometry args={[0.35, 0.6, 8, 16]} />
        <meshStandardMaterial ref={bodyMat} color="#4ea1ff" transparent />
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
