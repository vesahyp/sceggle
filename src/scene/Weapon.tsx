import type { WeaponDef } from '../weapons';

/**
 * The held-weapon mesh. It's a child of the wielder's group, so it inherits
 * the body's transform (the "hand"). Because it's driven purely by the
 * `def` prop, swapping weapons is a re-render, not manual scene-graph
 * surgery — React mounts the new blade and disposes the old one.
 */
export function Weapon({ def }: { def: WeaponDef }) {
  return (
    <group position={[0.35, 0.1, 0.15]} rotation={[0, 0, -Math.PI / 3]}>
      {/* blade */}
      <mesh position={[0, def.length / 2, 0]} castShadow>
        <boxGeometry args={[def.thickness, def.length, def.thickness]} />
        <meshStandardMaterial color={def.color} metalness={0.6} roughness={0.35} />
      </mesh>
      {/* hilt */}
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[def.thickness * 2.2, 0.12, def.thickness * 2.2]} />
        <meshStandardMaterial color="#5b3a1a" />
      </mesh>
    </group>
  );
}
