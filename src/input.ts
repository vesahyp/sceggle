import { useEffect } from 'react';

/**
 * Minimal keyboard tracker. Held keys live in a shared Set that the frame loop
 * polls (movement). Edge-triggered presses (attack, weapon swap) go through
 * one-shot callbacks so they fire once per keydown, not every frame.
 */
const held = new Set<string>();

export const keyboard = {
  isDown: (code: string) => held.has(code),
};

type PressHandlers = Record<string, () => void>;

/** Register held-state tracking plus optional per-key press callbacks. */
export function useKeyboard(onPress: PressHandlers = {}) {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (!held.has(e.code)) {
        onPress[e.code]?.();
      }
      held.add(e.code);
    };
    const up = (e: KeyboardEvent) => held.delete(e.code);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [onPress]);
}
