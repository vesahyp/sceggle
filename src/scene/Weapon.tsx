import type { WeaponDef } from '../weapons';
import { MELEE_BAND } from '../systems';

/**
 * The held-weapon mesh. It's a child of the wielder's aim pivot, so +Z is
 * the aim direction. Both kinds point forward along the aim.
 *
 * Melee is visually honest: the colored blade spans exactly the strike band
 * the swing connects in (reach ± MELEE_BAND), with a plain shaft bridging
 * the dead zone up close — a long polearm reads as "handle, then blade out
 * there". Ranged is a barrel tracking the cursor. Because it's driven
 * purely by the `def` prop, swapping weapons is a re-render, not manual
 * scene-graph surgery.
 */
export function Weapon({ def }: { def: WeaponDef }) {
  if (def.kind === 'ranged') {
    return (
      <group position={[0.3, 0.1, 0.1]}>
        {/* barrel — points along +Z, i.e. where you're aiming */}
        <mesh position={[0, 0, def.length / 2]} castShadow>
          <boxGeometry args={[def.thickness, def.thickness, def.length]} />
          <meshStandardMaterial color={def.color} metalness={0.6} roughness={0.35} />
        </mesh>
        {/* grip */}
        <mesh position={[0, -0.09, 0]}>
          <boxGeometry args={[def.thickness * 0.9, 0.14, 0.12]} />
          <meshStandardMaterial color="#5b3a1a" />
        </mesh>
      </group>
    );
  }

  const inner = Math.max(0.15, def.reach - MELEE_BAND);
  const outer = def.reach + MELEE_BAND;
  return (
    <group position={[0.22, 0.08, 0]}>
      {/* shaft — bridges the hand to where the blade starts (the dead zone) */}
      <mesh position={[0, 0, inner / 2]}>
        <boxGeometry args={[def.thickness * 0.6, def.thickness * 0.6, inner]} />
        <meshStandardMaterial color="#5b3a1a" />
      </mesh>
      {/* blade — spans exactly the strike band */}
      <mesh position={[0, 0, (inner + outer) / 2]} castShadow>
        <boxGeometry args={[def.thickness, def.thickness, outer - inner]} />
        <meshStandardMaterial color={def.color} metalness={0.6} roughness={0.35} />
      </mesh>
      {/* crossguard at the start of the blade */}
      <mesh position={[0, 0, inner]}>
        <boxGeometry args={[def.thickness * 3.2, def.thickness, 0.05]} />
        <meshStandardMaterial color="#5b3a1a" />
      </mesh>
    </group>
  );
}
