import { useEffect, useRef, useState } from 'react';
import { loadInitials, saveInitials, submitScore, type Period, PERIOD_LABELS } from '../api';
import type { RunSummary } from './Game';
import { tr } from '../i18n';
import { track } from '../records';

/**
 * Three letters, like a pinball machine. A hidden input drives the keyboard
 * on phones; the three boxes show what it holds.
 */
export function Initials({ r, onDone }: { r: RunSummary; onDone: (ranks: Record<Period, number> | null) => void }) {
  const [name, setName] = useState(() => loadInitials());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);

  // No focus on mount: on iOS, focusing an input inside the fixed body
  // scrolls the viewport, and every tap after that lands one element off
  // (Räkkä, 2026-09-27). The keyboard opens when the boxes are tapped, and
  // the scroll is put back when the input loses focus.
  useEffect(
    () => () => {
      window.scrollTo(0, 0);
    },
    [],
  );

  const clean = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
  const ok = name.length === 3;

  const send = async () => {
    if (!ok || busy) return;
    setBusy(true);
    setError('');
    saveInitials(name);
    try {
      const guns = r.guns.map((g) => `${g.type}:${g.maker}:${g.rarity}${g.legend ? ':' + g.legend : ''}`);
      const ranks = await submitScore({ name, hero: r.hero.id, floor: r.floor, time: r.time, kills: r.kills, coins: r.coins, bosses: r.bosses, guns });
      track('score', { floor: r.floor, rank_day: ranks.day, rank_all: ranks.all });
      onDone(ranks);
    } catch {
      setError(tr('Tulos ei mennyt perille. Paikallinen tulos on tallessa.', 'The score did not reach the server. It is saved on this device.'));
      setBusy(false);
    }
  };

  return (
    <div className="initials" data-ui onClick={() => input.current?.focus()}>
      {name.length < 3 && <div className="small">{tr('Napauta laatikoita ja kirjoita', 'Tap the boxes and type')}</div>}
      <div className="small">{tr('Nimikirjaimet tulostaululle', 'Your initials for the leaderboard')}</div>
      <div className="boxes">
        {[0, 1, 2].map((i) => (
          <div key={i} className={'box' + (name.length === i ? ' active' : '')}>
            {name[i] ?? ''}
          </div>
        ))}
      </div>
      <input
        ref={input}
        value={name}
        onChange={(e) => setName(clean(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void send();
        }}
        onBlur={() => window.scrollTo(0, 0)}
        maxLength={3}
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        inputMode="text"
        aria-label={tr('Nimikirjaimet', 'Initials')}
        className="initials-input"
      />
      {error && <div className="small" style={{ color: 'var(--danger)' }}>{error}</div>}
      <div className="row">
        <button className="btn primary" disabled={!ok || busy} onClick={() => void send()}>
          {busy ? tr('Lähetetään', 'Sending') : tr('Tallenna', 'Save')}
        </button>
        <button className="btn ghost" onClick={() => onDone(null)}>
          {tr('Ohita', 'Skip')}
        </button>
      </div>
    </div>
  );
}

/** "Today #3 · Week #12 · ...", best first; a top-three rank glows. */
export function RankLine({ ranks }: { ranks: Record<Period, number> }) {
  const best = (Object.keys(ranks) as Period[]).map((p) => [p, ranks[p]] as const).sort((a, b) => a[1] - b[1]);
  return (
    <div className="ranks">
      {best.map(([p, n]) => (
        <span key={p} className={n <= 3 ? 'top' : ''}>
          {PERIOD_LABELS[p]()} #{n}
        </span>
      ))}
    </div>
  );
}
