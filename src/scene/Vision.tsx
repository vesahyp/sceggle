import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { CanvasTexture, Mesh } from 'three';
import type { Entity } from '../ecs';

/** How far the player can see (world units). Must go fully dark inside the
 *  viewport's short axis (~8.2 world units at game zoom) or the fog never
 *  binds and vision is just the screen edge. */
export const VISION_RADIUS = 7;
/** Width of the clear → dark fade band beyond the vision edge. */
const FADE = 1.5;
/** Overlay plane size — must exceed the viewport at game zoom. */
const PLANE = 64;

/**
 * The player's range of vision: a ground-covering overlay that follows the
 * player, transparent inside VISION_RADIUS and fading to opaque dark beyond
 * it. Drawn depth-test-off above everything (including the depth-test-off
 * UI layers, via renderOrder), so whatever is out of sight is simply dark —
 * mobs, drops, and their bars included, with no per-object gating.
 */
export function Vision({ entity }: { entity: Entity }) {
  const mesh = useRef<Mesh>(null);

  const texture = useMemo(() => {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    // Gradient radius size/2 px spans PLANE/2 world units.
    const inner = VISION_RADIUS / (PLANE / 2);
    const outer = Math.min(1, (VISION_RADIUS + FADE) / (PLANE / 2));
    g.addColorStop(0, 'rgba(11, 13, 18, 0)');
    g.addColorStop(inner, 'rgba(11, 13, 18, 0)');
    g.addColorStop(outer, 'rgba(11, 13, 18, 1)');
    g.addColorStop(1, 'rgba(11, 13, 18, 1)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return new CanvasTexture(canvas);
  }, []);

  useFrame(() => {
    if (entity.pos) mesh.current?.position.set(entity.pos.x, 4, entity.pos.z);
  });

  return (
    <mesh ref={mesh} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2000} frustumCulled={false}>
      <planeGeometry args={[PLANE, PLANE]} />
      <meshBasicMaterial map={texture} transparent depthTest={false} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}
