import { useEffect, useRef } from 'react';
import { t, tr, num, lang, type Lang } from '../i18n';
import { HEROES, type HeroDef } from '../game/content/heroes';
import { MAKER_INFO, TYPE_NAME } from '../game/guns';
import { heroSprite, gunSprite, blit, setSpriteResolution } from '../render/sprites';
import { fmtTime, type Records } from '../records';
import { audio } from '../audio';
import type { RunSummary } from './Game';
import { GunCard } from './Cards';

function HeroPortrait({ d, size = 72 }: { d: HeroDef; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = size * dpr;
    cv.height = size * dpr;
    const c = cv.getContext('2d')!;
    const k = (size / 48) * dpr;
    setSpriteResolution(k);
    c.setTransform(k, 0, 0, k, 0, 0);
    c.fillStyle = 'rgba(0,0,0,0.3)';
    c.beginPath();
    c.ellipse(24, 40, 12, 4, 0, 0, Math.PI * 2);
    c.fill();
    blit(c, heroSprite(d, 0), 24, 28);
    c.save();
    c.translate(30, 33);
    c.rotate(-0.4);
    blit(c, gunSprite(d.start.type, d.start.maker, 1), 6, 0);
    c.restore();
  }, [d, size]);
  return <canvas ref={ref} style={{ width: size, height: size }} />;
}

export function Title({ records, onPlay, onRecords, onLang }: { records: Records; onPlay: () => void; onRecords: () => void; onLang: (l: Lang) => void }) {
  return (
    <div className="screen title">
      <div className="cogs" aria-hidden>
        <i className="c1" />
        <i className="c2" />
        <i className="c3" />
      </div>
      <h1 className="logo">HÖYRY</h1>
      <p className="tagline">{tr('Höyryä, rattaita ja aseita, jotka eivät ole ihan kunnossa.', 'Steam, cogs, and guns that are not quite right.')}</p>
      <button
        className="btn primary big"
        onClick={() => {
          audio.unlock();
          audio.play('tap');
          onPlay();
        }}
      >
        {tr('Pelaa', 'Play')}
      </button>
      {records.runs > 0 && (
        <button className="btn" onClick={onRecords}>
          {tr('Ennätykset', 'Records')}
        </button>
      )}
      {records.deepest > 0 && <p className="small">{tr(`Syvin kerros: ${records.deepest}`, `Deepest floor: ${records.deepest}`)}</p>}
      <div className="row">
        <button className="btn ghost" onClick={() => onLang(lang() === 'fi' ? 'en' : 'fi')}>
          {lang() === 'fi' ? 'English' : 'Suomeksi'}
        </button>
      </div>
      <p className="small credits">{tr('Tampere 1899. Tehtaan koneet heräsivät yöllä.', 'Tampere, 1899. The machines in the mill woke up one night.')}</p>
    </div>
  );
}

export function Select({ records, onPick, onBack }: { records: Records; onPick: (h: HeroDef) => void; onBack: () => void }) {
  return (
    <div className="screen">
      <h2>{tr('Kuka laskeutuu?', 'Who goes down?')}</h2>
      <div className="heroes">
        {HEROES.map((d) => (
          <button key={d.id} className="hero" onClick={() => onPick(d)}>
            <HeroPortrait d={d} size={56} />
            <div className="info">
              <div className="name">{t(d.name)}</div>
              <div className="title">{t(d.title)}</div>
              <div className="desc">{t(d.desc)}</div>
              <div className="super">
                ★ <b>{t(d.superName)}</b>: {t(d.superDesc)}
              </div>
              <div className="passive">{t(d.passive)}</div>
              <div className="start">
                {MAKER_INFO[d.start.maker].name} · {t(TYPE_NAME[d.start.type])} · ♥ {d.hp}
                {records.perHero[d.id] ? ` · ${tr('paras', 'best')} ${records.perHero[d.id].floor}` : ''}
              </div>
            </div>
          </button>
        ))}
      </div>
      <button className="btn ghost" onClick={onBack}>
        {tr('Takaisin', 'Back')}
      </button>
      {/* a hint that the list scrolls, for a phone short enough that the
          fourth card would otherwise look cut off with no explanation */}
      <div className="scrollhint" aria-hidden />
    </div>
  );
}

export function Death({ r, rank, heroBest, onAgain, onMenu }: { r: RunSummary; rank: number; heroBest: boolean; onAgain: () => void; onMenu: () => void }) {
  return (
    <div className="screen death">
      <h2>{tr(`Kaaduit kerroksessa ${r.floor}`, `You fell on floor ${r.floor}`)}</h2>
      {rank === 0 && <div className="record">{tr('Uusi ennätys!', 'New record!')}</div>}
      {rank > 0 && <div className="record">{tr(`Sija ${rank + 1} ennätyksissä`, `Number ${rank + 1} in your records`)}</div>}
      {rank !== 0 && heroBest && <div className="record">{tr(`${t(r.hero.name)}: paras tähän asti`, `${t(r.hero.name)}: best so far`)}</div>}
      <div className="stats">
        <span>{tr('Aika', 'Time')}</span>
        <b>{fmtTime(r.time)}</b>
        <span>{tr('Kaadot', 'Kills')}</span>
        <b>{num(r.kills)}</b>
        <span>{tr('Rattaat', 'Cogs')}</span>
        <b>{num(r.coins)}</b>
        <span>{tr('Pomot', 'Bosses')}</span>
        <b>{r.bosses}</b>
      </div>
      <div className="pauseguns">
        {r.guns.map((g) => (
          <GunCard key={g.id} g={g} compact />
        ))}
      </div>
      <div className="row">
        <button className="btn primary" onClick={onAgain}>
          {tr('Uudestaan', 'Again')}
        </button>
        <button className="btn ghost" onClick={onMenu}>
          {tr('Valikkoon', 'Menu')}
        </button>
      </div>
    </div>
  );
}

export function RecordsScreen({ records, onBack }: { records: Records; onBack: () => void }) {
  return (
    <div className="screen">
      <h2>{tr('Ennätykset', 'Records')}</h2>
      <table className="records">
        <thead>
          <tr>
            <th>#</th>
            <th>{tr('Hahmo', 'Hero')}</th>
            <th className="n">{tr('Kerros', 'Floor')}</th>
            <th className="n">{tr('Aika', 'Time')}</th>
            <th className="n">{tr('Kaadot', 'Kills')}</th>
          </tr>
        </thead>
        <tbody>
          {records.best.map((b, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td>{t(HEROES.find((h) => h.id === b.hero)?.name ?? { fi: b.hero, en: b.hero })}</td>
              <td className="n">{b.floor}</td>
              <td className="n">{fmtTime(b.time)}</td>
              <td className="n">{num(b.kills)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small">
        {tr(`Pelejä ${records.runs}, kaatoja yhteensä ${num(records.totalKills)}.`, `${records.runs} runs, ${num(records.totalKills)} kills in all.`)}
      </p>
      <button className="btn ghost" onClick={onBack}>
        {tr('Takaisin', 'Back')}
      </button>
    </div>
  );
}
