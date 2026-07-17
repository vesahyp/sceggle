import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { RigidBody, CapsuleCollider, type RapierRigidBody } from '@react-three/rapier';
import { Vector3 } from 'three';
import { publishBody, unpublishBody, type Entity } from '../ecs';
import type { WeaponDef } from '../weapons';
import { keyboard } from '../input';
import { Weapon } from './Weapon';

const SPEED = 5;
const CAM_OFFSET = new Vector3(0, 12, 8); // top-down, tilted for a 2.5D feel

/**
 * Player: a dynamic capsule locked upright and to the floor plane. Movement is
 * imperative (velocity from held keys, every frame) — React stays out of the
 * hot loop. The held weapon, by contrast, is declarative: pass a new `weapon`
 * prop and the blade swaps.
 */
export function Player({ entity, weapon, start }: { entity: Entity; weapon: WeaponDef; start: [number, number, number] }) {
  const body = useRef<RapierRigidBody>(null);
  const camera = useThree((s) => s.camera);

  // Clear the ECS handle on unmount (it's published from useFrame below, once
  // Rapier has actually created the body).
  useEffect(() => () => unpublishBody(entity), [entity]);

  useFrame(() => {
    const rb = body.current;
    if (!rb) return;
    publishBody(entity, rb); // publish the physics handle for systems (combat, AI)

    let x = 0;
    let z = 0;
    if (keyboard.isDown('KeyW') || keyboard.isDown('ArrowUp')) z -= 1;
    if (keyboard.isDown('KeyS') || keyboard.isDown('ArrowDown')) z += 1;
    if (keyboard.isDown('KeyA') || keyboard.isDown('ArrowLeft')) x -= 1;
    if (keyboard.isDown('KeyD') || keyboard.isDown('ArrowRight')) x += 1;

    const len = Math.hypot(x, z) || 1;
    const vel = rb.linvel();
    rb.setLinvel({ x: (x / len) * SPEED, y: vel.y, z: (z / len) * SPEED }, true);

    // Camera follows the player.
    const t = rb.translation();
    camera.position.lerp(new Vector3(t.x + CAM_OFFSET.x, t.y + CAM_OFFSET.y, t.z + CAM_OFFSET.z), 0.1);
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
      <Weapon def={weapon} />
    </RigidBody>
  );
}
