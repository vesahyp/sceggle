import { useEffect, useRef, useState } from 'react';
import { newRun, step, DT, nextFloor } from '../game/sim';
import type { SimState } from '../game/state';
import type { HeroDef } from '../game/content/heroes';
import { COG_BY_ID, type CogDef } from '../game/content/cogs';
import { BOSSES } from '../game/content/enemies';
import { rollCogs, applyCog } from '../game/upgrades';
import { maxAmmo } from '../game/weapons';
import { RARITY_COLOR } from '../game/guns';
import type { Gun } from '../game/types';
import { Renderer } from '../render/renderer';
import { InputController } from '../input/input';
import { audio } from '../audio';
import { Rng } from '../game/rng';
import { botInput, botPickCog } from '../../tools/autoplayer';
import { track } from '../records';
import { t, tr, num } from '../i18n';
import { CogCard, GunCard } from './Cards';
import { UpdateBanner } from './Update';

export interface RunSummary {
  hero: HeroDef;
  floor: number;
  time: number;
  kills: number;
  coins: number;
  bosses: number;
  guns: Gun[];
  bestRarity: number;
}

interface Hud {
  floor: number;
  coins: number;
  kills: number;
  boss: { name: string; hp: number; max: number } | null;
  banner: { text: string; sub: string; color?: string } | null;
  guns: { gun: Gun; ammo: number; max: number; active: boolean }[];
  superCharge: number;
  superName: string;
  near: Gun | null;
  enemies: number;
  phase: SimState['phase'];
}

type Overlay = { kind: 'none' } | { kind: 'cogs'; offers: CogDef[]; left: number } | { kind: 'pause' };

export function Game({ heroes, seed, onEnd, onQuit, onRestart }: { heroes: HeroDef[]; seed: number; onEnd: (r: RunSummary) => void; onQuit: () => void; onRestart: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const superRef = useRef<HTMLDivElement>(null);
  const moveStickRef = useRef<HTMLDivElement>(null);
  const aimStickRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<SimState | null>(null);
  const inputRef = useRef<InputController | null>(null);
  const overlayRef = useRef<Overlay>({ kind: 'none' });
  const [overlay, setOverlayState] = useState<Overlay>({ kind: 'none' });
  const [hud, setHud] = useState<Hud | null>(null);
  const [muted, setMuted] = useState(audio.muted);
  const endedRef = useRef(false);

  const setOverlay = (o: Overlay) => {
    overlayRef.current = o;
    setOverlayState(o);
  };

  useEffect(() => {
    const canvas = canvasRef.current!;
    const root = rootRef.current!;
    const s = newRun(seed, heroes);
    simRef.current = s;
    (window as unknown as { __sim: SimState }).__sim = s;
    const renderer = new Renderer(canvas);
    s.view = renderer.view();
    const input = new InputController();
    input.attach(root);
    inputRef.current = input;
    track('run_start', { hero: heroes.map((h) => h.id).join('+'), seed });
    audio.unlock();
    audio.startMusic();

    let wake: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
    if (window.top === window) nav.wakeLock?.request('screen').then((l) => (wake = l)).catch(() => undefined);

    const layoutSuper = () => {
      const el = superRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      input.superBtn = { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 };
    };
    const onResize = () => {
      renderer.resize();
      s.view = renderer.view();
      layoutSuper();
    };
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
    layoutSuper();

    const params = new URLSearchParams(location.search);
    const bot = params.get('bot') === '1';
    const speed = Math.max(1, Number(params.get('speed') ?? 1));
    const botRng = new Rng(seed ^ 0x5151);
    const perf = { frames: 0, ms: 0, worst: 0 };
    (window as unknown as { __perf: typeof perf }).__perf = perf;

    let reported = false;
    const report = (how: 'death' | 'quit' | 'closed') => {
      if (reported || s.time < 1) return;
      reported = true;
      const h = s.heroes[0];
      track('run_end', {
        hero: heroes.map((x) => x.id).join('+'),
        how,
        floor: s.floor,
        time: Math.round(s.time),
        kills: s.run.kills,
        coins: s.run.coins,
        guns: h.guns.map((g) => `${g.gun.type}:${g.gun.maker}:${g.gun.rarity}${g.gun.legend ? ':' + g.gun.legend : ''}`).join(','),
        cogs: Object.entries(h.cogs)
          .map(([k, v]) => `${k}:${v}`)
          .join(','),
      });
    };
    const onPageHide = () => report('closed');
    window.addEventListener('pagehide', onPageHide);

    const publishHud = () => {
      const h = s.heroes[0];
      const boss = s.enemies.find((e) => e.boss);
      const near = h.near !== null ? (s.drops.find((d) => d.id === h.near)?.gun ?? null) : null;
      setHud({
        floor: s.floor,
        coins: s.run.coins,
        kills: s.run.kills,
        boss: boss ? { name: t(BOSSES[(s.floor / 5 - 1) % BOSSES.length].name), hp: boss.hp, max: boss.maxHp } : null,
        banner: s.banner ? { text: s.banner.text, sub: s.banner.sub, color: s.banner.color } : null,
        guns: h.guns.map((g, i) => ({ gun: g.gun, ammo: g.ammo, max: maxAmmo(g, h), active: i === h.active })),
        superCharge: h.superCharge,
        superName: t(h.def.superName),
        near,
        enemies: s.enemies.length + s.marks.length,
        phase: s.phase,
      });
    };

    let last = performance.now();
    let acc = 0;
    let hudAcc = 0;
    let deathAcc = 0;
    let raf = 0;
    let pauseKey = false;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const ov = overlayRef.current;
      const pk = input.pressed('escape') || input.pressed('p');
      if (pk && !pauseKey) {
        if (ov.kind === 'none') setOverlay({ kind: 'pause' });
        else if (ov.kind === 'pause') setOverlay({ kind: 'none' });
      }
      pauseKey = pk;
      const t0 = performance.now();
      if (renderer.needsResize()) onResize();
      const h0 = s.heroes[0];
      // The mouse aims relative to where the hero is drawn.
      input.heroScreen = renderer.toScreen(h0.x, h0.y);
      input.range = h0.guns[h0.active].gun.range * h0.stats.rangeMul;
      if (ov.kind === 'none' && !s.gameOver) {
        acc += dt * speed;
        let n = 0;
        while (acc >= DT && n < 4 * speed) {
          step(s, s.heroes.map((h) => (bot ? botInput(s, h, botRng) : input.read())), DT);
          acc -= DT;
          n++;
          if (s.phase === 'done') {
            if (bot) {
              for (let k = 0; k < s.pendingCogs; k++) applyCog(h0, botPickCog(rollCogs(s, h0), botRng).id);
              s.pendingCogs = 0;
              nextFloor(s);
            } else {
              setOverlay({ kind: 'cogs', offers: rollCogs(s, h0), left: s.pendingCogs });
              break;
            }
          }
        }
        if (acc > DT * 4 * speed) acc = 0;
      } else if (s.gameOver) {
        step(s, [], dt);
        deathAcc += dt;
        if (deathAcc > 1.8 && !endedRef.current) {
          endedRef.current = true;
          report('death');
          onEnd({ hero: heroes[0], floor: s.floor, time: s.time, kills: s.run.kills, coins: s.run.coins, bosses: s.run.bosses, guns: h0.guns.map((g) => g.gun), bestRarity: s.run.bestRarity });
        }
      }
      if (s.sounds.length) {
        for (const name of s.sounds) audio.play(name);
        s.sounds.length = 0;
      }
      audio.intensity = s.bossFloor ? 1 : Math.min(1, s.enemies.length / 25);
      renderer.render(s, ov.kind === 'none' ? dt : 0, h0);
      drawSticks(input, moveStickRef.current, aimStickRef.current);
      const ms = performance.now() - t0;
      perf.frames++;
      perf.ms += ms;
      if (ms > perf.worst) perf.worst = ms;
      hudAcc += dt;
      if (hudAcc > 0.08) {
        hudAcc = 0;
        publishHud();
      }
    };
    raf = requestAnimationFrame(frame);

    const onVis = () => {
      if (document.visibilityState === 'hidden' && overlayRef.current.kind === 'none' && !s.gameOver) setOverlay({ kind: 'pause' });
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      report('quit');
      cancelAnimationFrame(raf);
      input.detach(root);
      window.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVis);
      audio.stopMusic();
      void wake?.release().catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickCog = (c: CogDef) => {
    const s = simRef.current!;
    const h = s.heroes[0];
    applyCog(h, c.id);
    audio.play('cog');
    s.pendingCogs--;
    if (s.pendingCogs > 0) setOverlay({ kind: 'cogs', offers: rollCogs(s, h), left: s.pendingCogs });
    else {
      nextFloor(s);
      setOverlay({ kind: 'none' });
    }
  };

  const s = simRef.current;
  const h0 = s?.heroes[0];
  const active = hud?.guns.find((g) => g.active)?.gun;

  return (
    <div className="game" ref={rootRef}>
      <canvas ref={canvasRef} />
      {hud && (
        <div className="hud">
          <div className="hudtop">
            <div className="floor">
              {tr('Kerros', 'Floor')} <b>{hud.floor}</b>
            </div>
            <div className="counts">
              <span className="coins">⚙ {num(hud.coins)}</span>
              <span className="kills">☠ {num(hud.kills)}</span>
              {hud.phase === 'fight' && hud.enemies > 0 && <span className="left">{tr(`${hud.enemies} jäljellä`, `${hud.enemies} left`)}</span>}
            </div>
          </div>
          {hud.boss && (
            <div className="bossbar">
              <div className="name">{hud.boss.name}</div>
              <div className="bar">
                <div style={{ width: `${(100 * Math.max(0, hud.boss.hp)) / hud.boss.max}%` }} />
              </div>
            </div>
          )}
        </div>
      )}
      {/* own element, not inside .hud: .hud shrinks to its content height, so a
          banner positioned by percentage inside it would sit near the top and
          overlap the floor counter and gun slots instead of sitting mid-screen */}
      {hud?.banner && (
        <div className="banner" key={hud.banner.text + hud.banner.sub}>
          <div className="t" style={hud.banner.color ? { color: hud.banner.color } : undefined}>
            {hud.banner.text}
          </div>
          <div className="s">{hud.banner.sub}</div>
        </div>
      )}
      <button className="iconbtn pause" data-ui onClick={() => setOverlay({ kind: 'pause' })} aria-label={tr('Tauko', 'Pause')}>
        ❚❚
      </button>
      <button
        className="iconbtn mute"
        data-ui
        onClick={() => {
          audio.setMuted(!muted);
          setMuted(!muted);
        }}
        aria-label={tr('Äänet', 'Sound')}
      >
        {muted ? '🔇' : '🔊'}
      </button>

      {/* the gun slots: tap to swap */}
      {hud && (
        <div className="slots" data-ui>
          {hud.guns.map((g, i) => (
            <button key={i} className={`slot ${g.active ? 'on' : ''}`} style={{ borderColor: RARITY_COLOR[g.gun.rarity] }} onClick={() => !g.active && inputRef.current?.swap()}>
              <div className="sname" style={{ color: RARITY_COLOR[g.gun.rarity] }}>
                {t(g.gun.name)}
              </div>
              <div className="pips">
                {Array.from({ length: g.max }, (_, k) => (
                  <i key={k} className={k < Math.floor(g.ammo) ? 'full' : ''} />
                ))}
              </div>
            </button>
          ))}
          {hud.guns.length < 2 && <div className="slot empty">{tr('Tyhjä paikka', 'Empty slot')}</div>}
        </div>
      )}

      {/* a gun on the floor under you */}
      {hud?.near && (
        <div className="pickup" data-ui>
          <GunCard g={hud.near} vs={active} />
          <button className="btn primary take" onClick={() => inputRef.current?.take()}>
            {hud.guns.length < 2 ? tr('Ota', 'Take') : tr('Vaihda tähän', 'Swap for this')} <small>E</small>
          </button>
        </div>
      )}

      {/* the super button; touches on it are read by the input, not React */}
      <div ref={superRef} className={`superbtn ${hud && hud.superCharge >= 1 ? 'ready' : ''}`} style={{ ['--charge' as string]: `${Math.round((hud?.superCharge ?? 0) * 100)}%` }}>
        <span>★</span>
        <small>{hud?.superName}</small>
      </div>
      <div className="stick" ref={moveStickRef}>
        <div />
      </div>
      <div className="stick aim" ref={aimStickRef}>
        <div />
      </div>

      {overlay.kind === 'cogs' && h0 && (
        <div className="overlay">
          <h2>{tr('Hissi nousee. Valitse ratas.', 'The lift rises. Pick a cog.')}</h2>
          {overlay.left > 1 && <p className="small">{tr(`Pomo kaatui: ${overlay.left} valintaa.`, `The boss fell: ${overlay.left} picks.`)}</p>}
          <div className="cards">
            {overlay.offers.map((c) => (
              <CogCard key={c.id} c={c} level={h0.cogs[c.id] ?? 0} onPick={() => pickCog(c)} />
            ))}
          </div>
          <OwnedCogs cogs={h0.cogs} />
        </div>
      )}
      {overlay.kind === 'pause' && h0 && (
        <div className="overlay">
          <h2>{tr('Tauko', 'Paused')}</h2>
          <div className="pauseguns">
            {h0.guns.map((g, i) => (
              <GunCard key={i} g={g.gun} />
            ))}
          </div>
          <OwnedCogs cogs={h0.cogs} />
          <div className="row">
            <button className="btn primary" onClick={() => setOverlay({ kind: 'none' })}>
              {tr('Jatka', 'Resume')}
            </button>
            <button className="btn" onClick={onRestart}>
              {tr('Alusta', 'Restart')}
            </button>
            <button className="btn ghost" onClick={onQuit}>
              {tr('Lopeta', 'Quit')}
            </button>
          </div>
          <p className="help">
            {tr(
              'Vasen peukalo kävelee. Oikea peukalo: napauta niin ase ampuu lähintä, vedä niin näet suunnan ja ammut kun nostat. Tähti on supervoima: se latautuu osumista. Näppäimistöllä WASD, hiiri tähtää ja ampuu, välilyönti on supervoima, Q vaihtaa asetta, E ottaa aseen maasta.',
              'Left thumb walks. Right thumb: tap and the gun fires at the nearest enemy, drag to see the line and fire when you lift. The star is your super: hits charge it. On a keyboard WASD walks, the mouse aims and fires, space is the super, Q swaps guns, E takes a gun from the floor.',
            )}
          </p>
        </div>
      )}
      {overlay.kind === 'none' && <UpdateBanner />}
    </div>
  );
}

function OwnedCogs({ cogs }: { cogs: Record<string, number> }) {
  const list = Object.entries(cogs);
  if (!list.length) return null;
  return (
    <div className="owned">
      {list.map(([id, n]) => (
        <span key={id} title={t(COG_BY_ID[id].name)}>
          {COG_BY_ID[id].icon}
          <b>{n}</b>
        </span>
      ))}
    </div>
  );
}

function drawSticks(input: InputController, move: HTMLDivElement | null, aim: HTMLDivElement | null): void {
  for (const [st, el] of [
    [input.move, move],
    [input.aim, aim],
  ] as const) {
    if (!el) continue;
    if (!st.active || (st === input.aim && !st.dragged)) {
      el.style.display = 'none';
      continue;
    }
    el.style.display = 'block';
    el.style.left = `${st.cx}px`;
    el.style.top = `${st.cy}px`;
    const dx = st.x - st.cx;
    const dy = st.y - st.cy;
    const d = Math.hypot(dx, dy);
    const m = Math.min(d, input.radius);
    const k = d > 0 ? m / d : 0;
    (el.firstChild as HTMLDivElement).style.transform = `translate(calc(-50% + ${dx * k}px), calc(-50% + ${dy * k}px))`;
  }
}
