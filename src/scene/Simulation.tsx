import { useFrame } from '@react-three/fiber';
import { stepSimulation } from '../systems';
import type { GameMap } from '../worldmap';

/**
 * Headless driver: runs the simulation tick once per frame. It renders
 * nothing, but living in the R3F tree means it shares the frame loop.
 * Priority -1 steps the sim *before* the view components (default priority)
 * copy positions into meshes, so what you see is always this frame's state.
 */
export function Simulation({ map }: { map: GameMap }) {
  // Clamp delta: after a background-tab pause it can be seconds, enough to
  // tunnel movers through obstacles in a single step.
  useFrame((_, delta) => stepSimulation(map, Math.min(delta, 0.1)), -1);
  return null;
}
