import { useEffect, useState } from 'react';
import { Game } from './Game';
import { MainMenu, CharacterSelect } from './Menu';
import type { CharacterDef } from './characters';

/** A run is a seed and a character; the nonce forces a Game remount even
 *  when both repeat (replaying a seed must restart it, not resume it). */
interface Run {
  seed: number;
  character: CharacterDef;
  nonce: number;
}

/**
 * The shell around the game: a screen state machine.
 *
 *   menu ──new game──► select ──start──► game
 *    ▲ ▲                                  │
 *    │ └───────────Esc / backgrounding────┘
 *    └──continue (run exists)──────────────
 *
 * Pre-run, `menu` is the title screen. Once a run exists the Game stays
 * MOUNTED and renders its own pause overlay (pack + help live with the
 * run's state) — this shell only decides which screen is up: `paused`
 * holds the sim whenever the game isn't front, `menuOpen` shows the
 * overlay. Only starting a new run remounts.
 */
export default function App() {
  const [run, setRun] = useState<Run | null>(null);
  const [screen, setScreen] = useState<'menu' | 'select' | 'game'>('menu');

  // Esc: pause to the menu mid-run, resume from it, back out of char select.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Escape') return;
      setScreen((s) => {
        if (s === 'game') return 'menu';
        if (s === 'select') return 'menu';
        return run ? 'game' : s;
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [run]);

  // Backgrounding the tab pauses into the menu — coming back never lands
  // you mid-horde.
  useEffect(() => {
    const onHide = () => {
      if (document.hidden) setScreen((s) => (s === 'game' ? 'menu' : s));
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, []);

  return (
    <>
      {run && (
        <Game
          key={run.nonce}
          seed={run.seed}
          character={run.character}
          paused={screen !== 'game'}
          menuOpen={screen === 'menu'}
          onOpenMenu={() => setScreen('menu')}
          onResume={() => setScreen('game')}
          onNewGame={() => setScreen('select')}
        />
      )}
      {screen === 'menu' && !run && <MainMenu onNewGame={() => setScreen('select')} />}
      {screen === 'select' && (
        <CharacterSelect
          onBack={() => setScreen('menu')}
          onStart={(character, seed) => {
            setRun((r) => ({ seed, character, nonce: (r?.nonce ?? 0) + 1 }));
            setScreen('game');
          }}
        />
      )}
    </>
  );
}
