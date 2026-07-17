import { useFrame } from '@react-three/fiber';
import { updateEnemyAI } from '../systems';
import type { Dungeon } from '../dungeon';

/**
 * Headless driver: runs the enemy AI system once per frame. It renders nothing
 * — it just steers mob bodies — but living in the R3F tree means it shares the
 * same frame loop as movement and physics.
 */
export function EnemyAI({ dungeon }: { dungeon: Dungeon }) {
  useFrame((_, delta) => updateEnemyAI(dungeon, delta));
  return null;
}
