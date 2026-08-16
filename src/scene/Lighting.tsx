import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Color, DirectionalLight, Matrix4, Vector3 } from 'three';
import type { GameMap } from '../worldmap';
import { VISION_RADIUS } from './Vision';

/** Unit axis the key light shines FROM — a low, raking angle so boxes throw
 *  long shadows across open ground instead of sitting on a dot. */
const KEY_FROM = new Vector3(0.6, 1, 0.42).normalize();
/** How far up that axis the light sits. Only sets the shadow frustum depth;
 *  a directional light's intensity doesn't fall off with distance. */
const KEY_DIST = 60;
const SHADOW_SIZE = 2048;
/**
 * Half-width of the shadow frustum. Sized to what the player can actually
 * see, NOT to the viewport: the vision overlay goes fully opaque a little
 * past VISION_RADIUS, so most of the screen is black no matter what the
 * light does. The margin covers casters standing just outside the disc whose
 * shadows still fall inside it, plus camera lerp lag and screen shake.
 */
const SHADOW_HALF = VISION_RADIUS + 6;
/** World size of one shadow texel — the snap grid's pitch. */
const TEXEL = (SHADOW_HALF * 2) / SHADOW_SIZE;

const UP = new Vector3(0, 1, 0);
const ORIGIN = new Vector3();
/** Rotation-only basis of the shadow camera. The shadow map's texel grid is
 *  aligned to these axes, so texel snapping has to happen in this space —
 *  snapping in world XZ leaves the grid sliding under the map. */
const LIGHT_TO_WORLD = new Matrix4().lookAt(KEY_FROM, ORIGIN, UP);
const WORLD_TO_LIGHT = LIGHT_TO_WORLD.clone().invert();

const focus = new Vector3();
const dir = new Vector3();
const snapped = new Vector3();

/**
 * All scene lighting, in one place.
 *
 * Key + fill + sky, and — the part that matters — a shadow camera that
 * actually covers what you can see. A directional light's default shadow
 * frustum is a ±5 box around the world origin, so on an 80×80 map with a
 * player-following camera, shadows existed in one corner and nowhere else.
 * Here the light rides the camera's ground focus with a frustum sized to the
 * player's sight radius, snapped to whole shadow texels so edges don't crawl
 * as you walk.
 *
 * Render-only: nothing here is read by the sim.
 */
export function Lighting({ map }: { map: GameMap }) {
  const camera = useThree((s) => s.camera);

  const light = useMemo(() => {
    const l = new DirectionalLight('#fff1d6', 1.9);
    l.castShadow = true;
    l.shadow.mapSize.set(SHADOW_SIZE, SHADOW_SIZE);
    // normalBias suits boxy geometry better than a flat depth bias: it pushes
    // the sample along the surface normal, so wide flat faces stop acneing
    // without lifting shadows off the wall bases that sell contact.
    l.shadow.normalBias = 0.02;
    l.shadow.bias = -0.0004;
    return l;
  }, []);

  useEffect(() => () => light.dispose(), [light]);

  // Fit the shadow frustum once — it tracks the player, so it never needs to
  // grow. 28 world units across 2048 texels is ~1.4cm each: at game zoom that
  // is sub-pixel, so box edges stay hard instead of stair-stepping.
  useEffect(() => {
    const c = light.shadow.camera;
    c.left = -SHADOW_HALF;
    c.right = SHADOW_HALF;
    c.top = SHADOW_HALF;
    c.bottom = -SHADOW_HALF;
    c.near = 1;
    c.far = KEY_DIST * 2;
    c.updateProjectionMatrix();
  }, [light]);

  // Ground bounce: the floor's own color thrown back up under everything, so
  // an object's underside belongs to the biome it's standing in.
  const bounce = useMemo(() => new Color(map.palette.ground).multiplyScalar(2.2), [map.palette.ground]);

  useFrame(() => {
    // Where the camera is aimed on the floor plane — the camera already
    // tracks the player, so following it keeps this decoupled from Player.
    camera.getWorldDirection(dir);
    if (dir.y > -1e-4) return;
    focus.copy(camera.position).addScaledVector(dir, -camera.position.y / dir.y);

    snapped.copy(focus).applyMatrix4(WORLD_TO_LIGHT);
    snapped.x = Math.round(snapped.x / TEXEL) * TEXEL;
    snapped.y = Math.round(snapped.y / TEXEL) * TEXEL;
    snapped.applyMatrix4(LIGHT_TO_WORLD);

    light.position.copy(snapped).addScaledVector(KEY_FROM, KEY_DIST);
    light.target.position.copy(snapped);
    light.target.updateMatrixWorld();
  });

  return (
    <>
      {/* Sky above, floor bounce below. A flat ambient lit every face of a
          box identically, which is exactly what flattens low-poly; this puts
          a gradient down every vertical surface for free. */}
      <hemisphereLight args={['#8fb4e8', bounce, 0.7]} />
      <primitive object={light} />
      <primitive object={light.target} />
      {/* Cool fill from the opposite side: keeps shadowed faces readable
          without washing out the key's direction. Casts nothing. */}
      <directionalLight position={[-8, 6, -10]} intensity={0.4} color="#7fa8d8" />
    </>
  );
}
