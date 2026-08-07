import { useState, type ReactNode } from 'react';
import {
  CHARACTERS,
  characterHp,
  characterSpeed,
  characterResist,
  PLATING_CAP,
  STAT_PICKS,
  type CharacterDef,
  type LevelSpend,
  type StatKey,
} from './characters';

/** Roll a shareable 6-digit world seed. The one place randomness is allowed
 *  outside ROT.RNG: this IS the root seed everything else derives from. */
export const rollSeed = () => 100000 + Math.floor(Math.random() * 900000);

/** Title screen — pre-run only. Once a run exists, pausing lands in the
 *  in-run GameMenu instead (Pack/Help live there, next to Continue). */
export function MainMenu({ onNewGame }: { onNewGame: () => void }) {
  return (
    <div className="menu">
      <div className="menu-panel">
        <h1 className="menu-title">sceggle</h1>
        <p className="menu-sub">a horde of cogs and steam</p>
        <button className="menu-btn menu-primary" onClick={onNewGame} autoFocus>
          New Game
        </button>
      </div>
    </div>
  );
}

/** The how-to-play text, retired from the always-on HUD into a menu tab. */
function Help() {
  return (
    <div className="help">
      <h3>Controls</h3>
      <ul>
        <li>
          <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move · <kbd>Mouse</kbd> aim ·{' '}
          <kbd>Click</kbd> / <kbd>Space</kbd> fire (hold to keep firing at the cursor)
        </li>
        <li>
          Lob guns aim while held — an arc traces the shell and a disc marks the blast — and
          fire on release. On touch, the aim stick sets the throw distance; ease it back to
          center and the preview turns red, meaning releasing there throws nothing.
        </li>
        <li>
          <kbd>Esc</kbd> pause menu · <kbd>I</kbd> pack · <kbd>H</kbd> this help
        </li>
        <li>Touch: left thumb moves, right thumb aims and fires · ⚙ opens this menu</li>
        <li>
          On iPhone/iPad: Add to Home Screen and launch from there — the game runs fullscreen
          without the browser bars.
        </li>
        <li>
          <kbd>1</kbd> dev: roll a gun into hand · <kbd>2</kbd> dev: a random cog into the pack
        </li>
      </ul>
      <h3>Field guide</h3>
      <ul>
        <li>Walk over drops to collect them; equip guns and install cogs in the Pack tab.</li>
        <li>
          Kills earn XP — elites pay far more than chaff. Each level pauses the fight for one
          stat point: vigor, boots, plating, or hands.
        </li>
        <li>Reach the gold pad to leave the area — expect it to be guarded.</li>
        <li>
          Exploders (orange) blow up both sides · spawners (purple) leak reinforcements while
          you're seen.
        </li>
        <li>
          Idle mobs wander: the blue cone is where one looks, the gold ring how far it hears
          YOU — it shrinks when you slow down and swells when you sprint, and your footstep
          ripples are the same noise. Keep out of both to sneak.
        </li>
        <li>
          Shots and explosions are heard, and whoever hears one goes to the BANG, not to you.
          Shoot and move; land a shell across the yard to pull a pack off yourself.
        </li>
        <li>
          Grass hides you from eyes (you fade), not ears — firing gives you away. Crates break
          under fire; red barrels detonate and chain, hurting everyone.
        </li>
        <li>
          Lob guns arc over walls and land at your cursor, torching the ground. Green fire is
          theirs — walk out of it.
        </li>
        <li>
          Steam jets spray a short wide cone that passes straight through bodies: little per
          puff, brutal on a packed front rank, and quiet enough to work a flank without
          calling the field over. You have to be close, though.
        </li>
      </ul>
    </div>
  );
}

/**
 * Level-up: the sim holds while the player spends the point — the same
 * pause-to-decide contract as the pack. One card per stat, current spend
 * shown so the build is legible; plating greys out at its cap.
 */
export function LevelUp({
  level,
  character,
  spent,
  onPick,
}: {
  level: number;
  character: CharacterDef;
  spent: LevelSpend;
  onPick: (key: StatKey) => void;
}) {
  const platingFull = character.spend.plating + spent.plating >= PLATING_CAP;
  return (
    <div className="menu">
      <div className="menu-panel">
        <h1 className="menu-title-sm">Level {level}</h1>
        <p className="menu-sub">spend a point</p>
        <div className="pick-grid">
          {STAT_PICKS.map((s) => {
            const disabled = s.key === 'plating' && platingFull;
            return (
              <button
                key={s.key}
                className="pick-card"
                disabled={disabled}
                onClick={() => onPick(s.key)}
              >
                <b>{s.name}</b>
                <span className="pick-effect">{disabled ? 'plated to the rivets' : s.effect}</span>
                <span className="pick-current">
                  now: {((character.spend as Partial<Record<StatKey, number>>)[s.key] ?? 0) + spent[s.key]} pts
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export type GameMenuTab = 'pack' | 'help';

/**
 * The in-run overlay: pause screen, pack, and help in one place. The sim is
 * held while it's up (App drives that via the same screen state). `children`
 * is the wired-up Inventory — the Game owns that state; this component only
 * decides when it shows.
 */
export function GameMenu({
  character,
  seed,
  area,
  level,
  kills,
  tab,
  onTab,
  onResume,
  onNewGame,
  children,
}: {
  character: CharacterDef;
  seed: number;
  area: number;
  level: number;
  kills: number;
  tab: GameMenuTab;
  onTab: (t: GameMenuTab) => void;
  onResume: () => void;
  onNewGame: () => void;
  children: ReactNode;
}) {
  return (
    <div className="menu">
      <div className="menu-panel menu-wide">
        <div className="menu-head">
          <div>
            <h1 className="menu-title-sm">paused</h1>
            <p className="menu-run">
              {character.name} lv <b>{level}</b> · seed <b>{seed}</b> · area <b>{area}</b> ·{' '}
              {kills} kills
            </p>
          </div>
          <div className="game-tabs">
            <button
              className={`menu-btn menu-slim${tab === 'pack' ? ' menu-tab-active' : ''}`}
              onClick={() => onTab('pack')}
            >
              Pack
            </button>
            <button
              className={`menu-btn menu-slim${tab === 'help' ? ' menu-tab-active' : ''}`}
              onClick={() => onTab('help')}
            >
              Help
            </button>
          </div>
        </div>
        <div className="menu-content">{tab === 'pack' ? children : <Help />}</div>
        <div className="menu-row">
          <button className="menu-btn menu-slim" onClick={onNewGame}>
            New Game
          </button>
          <button className="menu-btn menu-primary" onClick={onResume} autoFocus>
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

/** One archetype card: name, stereotype, stat bars, starter-gun line. */
function CharacterCard({
  c,
  selected,
  onSelect,
}: {
  c: CharacterDef;
  selected: boolean;
  onSelect: () => void;
}) {
  // Bar scales: normalized against the highest value any spend can reach,
  // so the bars compare archetypes truthfully.
  const bars: Array<[string, number]> = [
    ['vigor', c.spend.vigor],
    ['boots', c.spend.boots],
    ['plating', c.spend.plating],
    ['barrel', c.spend.barrel],
  ];
  const resist = characterResist(c);
  return (
    <div className={`char-card${selected ? ' selected' : ''}`} onClick={onSelect}>
      <div className="char-head">
        <span className="char-dot" style={{ background: c.tint }} />
        <b>{c.name}</b>
        <span className="char-role">{c.role}</span>
      </div>
      <p className="char-blurb">{c.blurb}</p>
      <div className="char-stats">
        {bars.map(([label, pts]) => (
          <div className="char-stat" key={label}>
            <span>{label}</span>
            <div className="char-bar">
              <div style={{ width: `${(pts / 8) * 100}%`, background: c.tint }} />
            </div>
          </div>
        ))}
      </div>
      <div className="char-numbers">
        {characterHp(c)} HP · {characterSpeed(c)} speed
        {resist.knockback > 0 && <> · {Math.round(resist.knockback * 100)}% shove resist</>}
      </div>
      <div className="char-gun">starts with: a {c.gunLine}</div>
    </div>
  );
}

/**
 * New-game flow: pick an archetype, take (or reroll, or type) a world seed,
 * start. Entering a seed you've seen replays that exact run — same map,
 * rosters, drops, starter gun.
 */
export function CharacterSelect({
  onStart,
  onBack,
}: {
  onStart: (character: CharacterDef, seed: number) => void;
  onBack: () => void;
}) {
  const [selectedId, setSelectedId] = useState(CHARACTERS[0].id);
  const [seedText, setSeedText] = useState(() => String(rollSeed()));
  const selected = CHARACTERS.find((c) => c.id === selectedId)!;
  const seed = Number.parseInt(seedText, 10);
  const seedOk = Number.isFinite(seed) && seed > 0;

  return (
    <div className="menu">
      <div className="menu-panel menu-wide">
        <h1 className="menu-title-sm">Choose your operator</h1>
        <div className="char-grid">
          {CHARACTERS.map((c) => (
            <CharacterCard
              key={c.id}
              c={c}
              selected={c.id === selectedId}
              onSelect={() => setSelectedId(c.id)}
            />
          ))}
        </div>
        <div className="seed-row">
          <label htmlFor="seed">world seed</label>
          <input
            id="seed"
            inputMode="numeric"
            value={seedText}
            onChange={(e) => setSeedText(e.target.value.replace(/\D/g, ''))}
          />
          <button className="menu-btn menu-slim" onClick={() => setSeedText(String(rollSeed()))}>
            ⟳ reroll
          </button>
        </div>
        <p className="seed-hint">
          Every roll in a run — map, hordes, drops, your starter gun — derives from this one
          number. Re-enter a seed to replay that run.
        </p>
        <div className="menu-row">
          <button className="menu-btn menu-slim" onClick={onBack}>
            ‹ Back
          </button>
          <button
            className="menu-btn menu-primary"
            disabled={!seedOk}
            onClick={() => seedOk && onStart(selected, seed)}
          >
            Start Run
          </button>
        </div>
      </div>
    </div>
  );
}
