import { useCallback, useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import { Group, Material, Mesh } from 'three';
import { onGameEvent } from '../events';

const LIFE = 0.8; // seconds a number lives
const RISE = 0.9; // world units it floats up
const MAX_ON_SCREEN = 30;

interface Item {
  key: number;
  x: number;
  z: number;
  amount: number;
  color: string;
}

let serial = 0;

/**
 * Floating damage numbers: every `damage` event spawns a billboarded number
 * at the hit that rises and fades out. Size scales with the amount — small
 * hit, small number; big hit, big number. Gold = damage you dealt,
 * red = damage you took. Spawning is declarative (React mounts/disposes the
 * short-lived Text meshes); the per-frame motion is imperative.
 */
export function DamageNumbers() {
  const [items, setItems] = useState<Item[]>([]);

  useEffect(
    () =>
      onGameEvent((e) => {
        if (e.type !== 'damage') return;
        setItems((list) => [
          ...list.slice(-(MAX_ON_SCREEN - 1)),
          { key: ++serial, x: e.x, z: e.z, amount: e.amount, color: e.target === 'mob' ? '#ffd166' : '#ff6b6b' },
        ]);
      }),
    [],
  );

  const remove = useCallback((key: number) => {
    setItems((list) => list.filter((i) => i.key !== key));
  }, []);

  return (
    <>
      {items.map((i) => (
        <FloatingNumber key={i.key} item={i} onDone={remove} />
      ))}
    </>
  );
}

function FloatingNumber({ item, onDone }: { item: Item; onDone: (key: number) => void }) {
  const group = useRef<Group>(null);
  const text = useRef<Mesh>(null);
  const t = useRef(0);

  useFrame(({ camera }, delta) => {
    t.current += delta;
    const k = t.current / LIFE;
    if (k >= 1) {
      onDone(item.key);
      return;
    }
    const g = group.current;
    if (!g) return;
    g.position.set(item.x, 1.3 + k * RISE, item.z);
    g.quaternion.copy(camera.quaternion);
    // Ease-out fade over the back half of the life.
    const mat = text.current?.material as Material | undefined;
    if (mat) mat.opacity = k < 0.5 ? 1 : 1 - (k - 0.5) * 2;
  });

  return (
    <group ref={group} renderOrder={1000}>
      <Text
        ref={text}
        fontSize={Math.min(0.7, 0.26 + item.amount * 0.07)}
        color={item.color}
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.02}
        outlineColor="#10131a"
      >
        {item.amount}
      </Text>
    </group>
  );
}
