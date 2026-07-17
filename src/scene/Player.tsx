import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { RigidBody, CapsuleCollider, type RapierRigidBody } from '@react-three/rapier';
import { Group, Plane, Vector3 } from 'three';
import { publishBody, unpublishBody, type Entity } from '../ecs';
import type { WeaponDef } from '../weapons';
import { keyboard } from '../input';
import { performAttack } from '../systems';
import { Weapon } from './Weapon';

const SPEED = 5;
const CAM_OFFSET = new Vector3(0, 12, 8); // top-down, tilted for a 2.5D feel

const SWING_DURATION = 0.18; // seconds
const SWING_HALF = 1.1; // radians the blade sweeps to each side of the aim

// Scratch objects reused each frame (avoid per-frame allocation).
const groundPlane = new Plane(new Vector3(0, 1, 0), 0);
const hitPoint = new Vector3();
const camTarget = new Vector3();

/**
 * Player: a dynamic capsule locked upright and to the floor plane. Movement is
 * imperative (velocity from held keys); aim comes from the mouse projected onto
 * the ground. The held weapon sweeps through an arc when you swing, and combat
 * shoves enemies in that aim direction (see systems.performAttack). React stays
 * out of the hot loop; only the weapon *prop* (which blade) is declarative.
 */
export function Player({ entity, weapon, start }: { entity: Entity; weapon: WeaponDef; start: [number, number, number] }) {
  const body = useRef<RapierRigidBody>(null);
  const weaponPivot = useRef<Group>(null);
  const swing = useRef({ t: 0, active: false });
  const camera = useThree((s) => s.camera);
  const pointer = useThree((s) => s.pointer);
  const raycaster = useThree((s) => s.raycaster);

  useEffect(() => () => unpublishBody(entity), [entity]);

  // Attack input: left mouse button or Space. One swing at a time.
  useEffect(() => {
    const attack = () => {
      if (swing.current.active) return;
      swing.current.active = true;
      swing.current.t = 0;
      performAttack(); // reads entity.aim, set in useFrame below
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') attack();
    };
    const onMouse = (e: MouseEvent) => {
      if (e.button === 0) attack();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onMouse);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onMouse);
    };
  }, []);

  useFrame((_, delta) => {
    const rb = body.current;
    if (!rb) return;
    publishBody(entity, rb);

    // --- Movement (held keys) ---
    let x = 0;
    let z = 0;
    if (keyboard.isDown('KeyW') || keyboard.isDown('ArrowUp')) z -= 1;
    if (keyboard.isDown('KeyS') || keyboard.isDown('ArrowDown')) z += 1;
    if (keyboard.isDown('KeyA') || keyboard.isDown('ArrowLeft')) x -= 1;
    if (keyboard.isDown('KeyD') || keyboard.isDown('ArrowRight')) x += 1;
    const len = Math.hypot(x, z) || 1;
    const vel = rb.linvel();
    rb.setLinvel({ x: (x / len) * SPEED, y: vel.y, z: (z / len) * SPEED }, true);

    const t = rb.translation();

    // --- Aim (mouse projected onto the player's ground plane) ---
    groundPlane.constant = -t.y;
    raycaster.setFromCamera(pointer, camera);
    if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
      const ax = hitPoint.x - t.x;
      const az = hitPoint.z - t.z;
      const al = Math.hypot(ax, az);
      if (al > 0.15) entity.aim = { x: ax / al, z: az / al };
    }

    // --- Weapon orientation + swing animation ---
    const aim = entity.aim ?? { x: 0, z: 1 };
    const yaw = Math.atan2(aim.x, aim.z);
    let swingAngle = 0;
    if (swing.current.active) {
      swing.current.t += delta;
      const k = Math.min(swing.current.t / SWING_DURATION, 1);
      swingAngle = (0.5 - k) * 2 * SWING_HALF; // sweep +SWING_HALF -> -SWING_HALF
      if (k >= 1) swing.current.active = false;
    }
    if (weaponPivot.current) weaponPivot.current.rotation.y = yaw + swingAngle;

    // --- Camera follows the player ---
    camTarget.set(t.x + CAM_OFFSET.x, t.y + CAM_OFFSET.y, t.z + CAM_OFFSET.z);
    camera.position.lerp(camTarget, 0.1);
    camera.lookAt(t.x, t.y, t.z);
  });

  return (
    <RigidBody
      ref={body}
      position={start}
      colliders={false}
      enabledRotations={[false, false, false]}
      enabledTranslations={[true, false, true]}
      linearDamping={8}
    >
      <CapsuleCollider args={[0.3, 0.35]} />
      <mesh castShadow>
        <capsuleGeometry args={[0.35, 0.6, 8, 16]} />
        <meshStandardMaterial color="#4ea1ff" />
      </mesh>
      {/* Pivot rotates the weapon to the aim direction and sweeps it on swing. */}
      <group ref={weaponPivot}>
        <Weapon def={weapon} />
      </group>
    </RigidBody>
  );
}
