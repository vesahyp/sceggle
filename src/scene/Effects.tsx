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
const BURST_LIFE = 0.5;
const MAX_ON_SCREEN = 32;

type Fx =
  | { kind: 'explosion'; key: number; x: number; z: number; radius: number }
  | { kind: 'arc'; key: number; x1: number; z1: number; x2: number; z2: number }
  | { kind: 'burst'; key: number; x: number; z: number; tint: string };

let serial = 0;

/** Deterministic per-spark jitter — the render layer draws no RNG. */
const hash = (n: number) => {
  const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
};

/**
 * Short-lived combat spectacle, same pattern as DamageNumbers: sim events
 * mount tiny declarative effects, each animates imperatively and unmounts
 * itself. Explosions are an expanding ground shockwave ring; chain lightning
 * is a bright beam flashed between the arc's endpoints; kills pop a spark
 * burst in the victim's color.
 */
export function Effects() {
  const [items, setItems] = useState<Fx[]>([]);

  useEffect(
    () =>
      onGameEvent((e) => {
        let fx: Fx | null = null;
        if (e.type === 'explosion') fx = { kind: 'explosion', key: ++serial, x: e.x, z: e.z, radius: e.radius };
        else if (e.type === 'arc') fx = { kind: 'arc', key: ++serial, x1: e.x1, z1: e.z1, x2: e.x2, z2: e.z2 };
        else if (e.type === 'mobDied' && e.mob.pos) {
          fx = { kind: 'burst', key: ++serial, x: e.mob.pos.x, z: e.mob.pos.z, tint: e.mob.tint ?? '#ffd166' };
        }
        if (!fx) return;
        const next = fx;
        setItems((list) => [...list.slice(-(MAX_ON_SCREEN - 1)), next]);
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
        ) : i.kind === 'arc' ? (
          <Arc key={i.key} fx={i} onDone={remove} />
        ) : (
          <KillBurst key={i.key} fx={i} onDone={remove} />
        ),
      )}
    </>
  );
}

const SPARKS = 9;

/**
 * A kill pops: sparks in the victim's color fly out ballistically while a
 * small bright ring snaps open at the feet. Spark directions/speeds come
 * from a hash of the effect key (deterministic, RNG-free), so every death
 * looks slightly different without touching the sim's stream.
 */
function KillBurst({ fx, onDone }: { fx: Fx & { kind: 'burst' }; onDone: (key: number) => void }) {
  const group = useRef<Group>(null);
  const ringMat = useRef<MeshBasicMaterial>(null);
  const ring = useRef<Mesh>(null);
  const t = useRef(0);

  useFrame((_, delta) => {
    t.current += delta;
    const k = t.current / BURST_LIFE;
    if (k >= 1) {
      onDone(fx.key);
      return;
    }
    const g = group.current;
    if (g) {
      for (let i = 0; i < g.children.length; i++) {
        const s = g.children[i];
        const h1 = hash(fx.key * 13 + i);
        const h2 = hash(fx.key * 29 + i * 7);
        const a = ((i + h1) / SPARKS) * Math.PI * 2;
        const speed = 2.2 + h2 * 2.2;
        const up = 2.6 + h1 * 1.6;
        s.position.set(
          Math.sin(a) * speed * t.current,
          0.55 + up * t.current - 7 * t.current * t.current,
          Math.cos(a) * speed * t.current,
        );
        const shrink = Math.max(0.001, 1 - k);
        s.scale.setScalar(shrink * (0.7 + h2 * 0.6));
        s.rotation.set(a * 3 + t.current * 12, t.current * 9, 0);
      }
    }
    // The ring snaps open fast and fades.
    const ease = 1 - (1 - k) * (1 - k);
    ring.current?.scale.setScalar(Math.max(0.01, 0.9 * ease));
    if (ringMat.current) ringMat.current.opacity = 0.9 * (1 - k);
  });

  return (
    <group position={[fx.x, 0, fx.z]}>
      <group ref={group}>
        {Array.from({ length: SPARKS }, (_, i) => (
          <mesh key={i}>
            <boxGeometry args={[0.13, 0.13, 0.13]} />
            {/* Every third spark is a white-hot fleck; the rest carry the
                victim's color out of the body. */}
            <meshBasicMaterial color={i % 3 === 0 ? '#ffffff' : fx.tint} />
          </mesh>
        ))}
      </group>
      <mesh ref={ring} geometry={RING_GEOM} position={[0, 0.07, 0]} renderOrder={992}>
        <meshBasicMaterial ref={ringMat} color="#ffffff" transparent side={DoubleSide} depthWrite={false} depthTest={false} />
      </mesh>
    </group>
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
