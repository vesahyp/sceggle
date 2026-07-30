import { useCallback, useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { DoubleSide, Group, Mesh, MeshBasicMaterial, RingGeometry, BoxGeometry } from 'three';
import { onGameEvent } from '../events';

// Shared unit geometries, scaled per effect instance.
const RING_GEOM = new RingGeometry(0.82, 1, 40);
RING_GEOM.rotateX(-Math.PI / 2);
// Unit-length beam along +Z, origin-anchored so scale.z stretches it A→B.
const ARC_GEOM = new BoxGeometry(0.07, 0.07, 1);
ARC_GEOM.translate(0, 0, 0.5);

const EXPLOSION_LIFE = 0.35;
const ARC_LIFE = 0.16;
const MAX_ON_SCREEN = 24;

type Fx =
  | { kind: 'explosion'; key: number; x: number; z: number; radius: number }
  | { kind: 'arc'; key: number; x1: number; z1: number; x2: number; z2: number };

let serial = 0;

/**
 * Short-lived combat spectacle, same pattern as DamageNumbers: sim events
 * mount tiny declarative effects, each animates imperatively and unmounts
 * itself. Explosions are an expanding ground shockwave ring; chain lightning
 * is a bright beam flashed between the arc's endpoints.
 */
export function Effects() {
  const [items, setItems] = useState<Fx[]>([]);

  useEffect(
    () =>
      onGameEvent((e) => {
        if (e.type !== 'explosion' && e.type !== 'arc') return;
        setItems((list) => [
          ...list.slice(-(MAX_ON_SCREEN - 1)),
          e.type === 'explosion'
            ? { kind: 'explosion', key: ++serial, x: e.x, z: e.z, radius: e.radius }
            : { kind: 'arc', key: ++serial, x1: e.x1, z1: e.z1, x2: e.x2, z2: e.z2 },
        ]);
      }),
    [],
  );

  const remove = useCallback((key: number) => {
    setItems((list) => list.filter((i) => i.key !== key));
  }, []);

  return (
    <>
      {items.map((i) =>
        i.kind === 'explosion' ? (
          <Shockwave key={i.key} fx={i} onDone={remove} />
        ) : (
          <Arc key={i.key} fx={i} onDone={remove} />
        ),
      )}
    </>
  );
}

function Shockwave({ fx, onDone }: { fx: Fx & { kind: 'explosion' }; onDone: (key: number) => void }) {
  const group = useRef<Group>(null);
  const mat = useRef<MeshBasicMaterial>(null);
  const t = useRef(0);

  useFrame((_, delta) => {
    t.current += delta;
    const k = t.current / EXPLOSION_LIFE;
    if (k >= 1) {
      onDone(fx.key);
      return;
    }
    // Ease-out expansion to the blast radius, fading as it goes.
    const ease = 1 - (1 - k) * (1 - k);
    group.current?.scale.setScalar(Math.max(0.01, fx.radius * ease));
    if (mat.current) mat.current.opacity = 0.85 * (1 - k);
  });

  return (
    <group ref={group} position={[fx.x, 0.06, fx.z]}>
      <mesh geometry={RING_GEOM} renderOrder={992}>
        <meshBasicMaterial
          ref={mat}
          color="#ffb45f"
          transparent
          side={DoubleSide}
          depthWrite={false}
          depthTest={false}
        />
      </mesh>
    </group>
  );
}

function Arc({ fx, onDone }: { fx: Fx & { kind: 'arc' }; onDone: (key: number) => void }) {
  const mesh = useRef<Mesh>(null);
  const mat = useRef<MeshBasicMaterial>(null);
  const t = useRef(0);

  useFrame((_, delta) => {
    t.current += delta;
    const k = t.current / ARC_LIFE;
    if (k >= 1) {
      onDone(fx.key);
      return;
    }
    if (mat.current) mat.current.opacity = 1 - k;
  });

  const dx = fx.x2 - fx.x1;
  const dz = fx.z2 - fx.z1;
  const len = Math.hypot(dx, dz) || 0.01;

  return (
    <mesh
      ref={mesh}
      geometry={ARC_GEOM}
      position={[fx.x1, 0.75, fx.z1]}
      rotation={[0, Math.atan2(dx, dz), 0]}
      scale={[1, 1, len]}
      renderOrder={993}
    >
      <meshBasicMaterial ref={mat} color="#9fe4ff" transparent depthWrite={false} depthTest={false} />
    </mesh>
  );
}
