import { useEffect, useRef } from 'react';
import { RigidBody, CapsuleCollider, type RapierRigidBody } from '@react-three/rapier';
import type { Entity } from '../ecs';
import type { WeaponDef } from '../weapons';
import { Weapon } from './Weapon';

/**
 * A mob (goblin). Same rigid-body setup as the player, but no input — it just
 * stands there and takes knockback. Its held weapon is a prop too, so
 * "switch the weapon on the mob" is the exact same one-liner as for the player:
 * change the component, the mesh follows.
 */
export function Mob({ entity, weapon, start }: { entity: Entity; weapon: WeaponDef; start: [number, number, number] }) {
  const body = useRef<RapierRigidBody>(null);

  useEffect(() => {
    entity.rb = body.current;
    return () => {
      entity.rb = null;
    };
  }, [entity]);

  return (
    <RigidBody
      ref={body}
      position={start}
      colliders={false}
      enabledRotations={[false, false, false]}
      enabledTranslations={[true, false, true]}
      linearDamping={4}
    >
      <CapsuleCollider args={[0.28, 0.32]} />
      <mesh castShadow>
        <capsuleGeometry args={[0.32, 0.5, 8, 16]} />
        <meshStandardMaterial color="#5fd35f" />
      </mesh>
      <Weapon def={weapon} />
    </RigidBody>
  );
}
