import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, InstancedMesh, Object3D } from 'three';
import { loots } from '../ecs';

/** Instance capacity per kind — a horde area drops a lot. */
const MAX = 128;

const dummy = new Object3D();
const color = new Color();

/**
 * Renders every loot entity, split across two instanced meshes so the two
 * pickup kinds read at a glance: weapons are cubes tinted by level, mechanism
 * parts are squat "cog" cylinders tinted by effect type. Both slowly spin so
 * drops read against the ground. Imperative like Projectiles — drops
 * appear/vanish without React.
 */
export function Loot() {
  const cubes = useRef<InstancedMesh>(null);
  const cogs = useRef<InstancedMesh>(null);

  useFrame(({ clock }) => {
    const wm = cubes.current;
    const cm = cogs.current;
    if (!wm || !cm) return;
    let wi = 0;
    let ci = 0;
    for (const item of loots) {
      if (item.loot.weapon && wi < MAX) {
        dummy.position.set(item.pos.x, 0.25, item.pos.z);
        dummy.rotation.set(0, clock.elapsedTime * 1.5, 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        wm.setMatrixAt(wi, dummy.matrix);
        wm.setColorAt(wi, color.set(item.loot.weapon.color));
        wi++;
      } else if (item.loot.part && ci < MAX) {
        dummy.position.set(item.pos.x, 0.22, item.pos.z);
        dummy.rotation.set(0, clock.elapsedTime * 2.2, 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        cm.setMatrixAt(ci, dummy.matrix);
        cm.setColorAt(ci, color.set(item.loot.part.color));
        ci++;
      }
    }
    wm.count = wi;
    wm.instanceMatrix.needsUpdate = true;
    if (wm.instanceColor) wm.instanceColor.needsUpdate = true;
    cm.count = ci;
    cm.instanceMatrix.needsUpdate = true;
    if (cm.instanceColor) cm.instanceColor.needsUpdate = true;
  });

  return (
    <>
      <instancedMesh ref={cubes} args={[undefined, undefined, MAX]} frustumCulled={false}>
        <boxGeometry args={[0.35, 0.35, 0.35]} />
        <meshStandardMaterial metalness={0.4} roughness={0.4} />
      </instancedMesh>
      {/* Six flat sides — reads as a gear/cog, distinct from the cubes. */}
      <instancedMesh ref={cogs} args={[undefined, undefined, MAX]} frustumCulled={false}>
        <cylinderGeometry args={[0.24, 0.24, 0.12, 6]} />
        <meshStandardMaterial metalness={0.5} roughness={0.35} />
      </instancedMesh>
    </>
  );
}
