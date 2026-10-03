import { useEffect, useRef, useState } from 'react';
import { t, tr, num, lang, type Lang } from '../i18n';
import { HEROES, type HeroDef } from '../game/content/heroes';
import { MAKER_INFO, TYPE_NAME } from '../game/guns';
import { heroSprite, gunSprite, blit, setSpriteResolution } from '../render/sprites';
import { fmtTime, type Records, type RunRecord } from '../records';
import { audio } from '../audio';
import { fetchBoard, rankIn, loadInitials, PERIOD_LABELS, RECORDS_ON, type Board, type Period } from '../api';
import type { RunSummary } from './Game';
import { GunCard } from './Cards';
import { Initials, RankLine } from './Initials';

const heroName = (id: string) => t(HEROES.find((h) => h.id === id)?.name ?? { fi: id, en: id });

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
      {(RECORDS_ON || records.runs > 0) && (
        <button className="btn" onClick={onRecords}>
          {RECORDS_ON ? tr('Tulostaulu', 'Leaderboard') : tr('Ennätykset', 'Records')}
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
  // A run that ends on floor 1 cleared nothing and stays off the table; the API refuses it too.
  const [stage, setStage] = useState<'ask' | 'done'>(RECORDS_ON && r.floor >= 2 ? 'ask' : 'done');
  const [ranks, setRanks] = useState<Record<Period, number> | null>(null);
  return (
    <div className="screen death">
      <h2>{tr(`Kaaduit kerroksessa ${r.floor}`, `You fell on floor ${r.floor}`)}</h2>
      {stage === 'ask' && (
        <Initials
          r={r}
          onDone={(rk) => {
            setRanks(rk);
            setStage('done');
          }}
        />
      )}
      {ranks && <RankLine ranks={ranks} />}
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
      {stage === 'done' && (
        <div className="row">
          <button className="btn primary" onClick={onAgain}>
            {tr('Uudestaan', 'Again')}
          </button>
          <button className="btn ghost" onClick={onMenu}>
            {tr('Valikkoon', 'Menu')}
          </button>
        </div>
      )}
    </div>
  );
}

/** "Updated 40 s ago": the board is cached for a minute, so it can be that old. */
function updatedText(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  const ago = s < 60 ? `${s} s` : `${Math.round(s / 60)} min`;
  return tr(`Päivitetty ${ago} sitten`, `Updated ${ago} ago`);
}

const TABS: (Period | 'mine')[] = RECORDS_ON ? ['day', 'week', 'month', 'all', 'mine'] : ['mine'];

/** The period key of a date on this device's clock: the same keys the API uses in Helsinki time. */
function periodKey(period: Period, d: Date): string {
  if (period === 'all') return 'ALL';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  if (period === 'day') return `${y}-${m}-${day}`;
  if (period === 'month') return `${y}-${m}`;
  const x = new Date(Date.UTC(y, d.getMonth(), d.getDate()));
  const dow = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() + 4 - dow);
  const start = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((x.getTime() - start.getTime()) / 86400000 + 1) / 7);
  return `${x.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** My best local run inside the period, by this device's clock: the deepest floor, then the shorter time. */
function myBestIn(period: Period, best: RunRecord[]): RunRecord | null {
  const now = periodKey(period, new Date());
  let top: RunRecord | null = null;
  for (const r of best) {
    if (periodKey(period, new Date(r.date)) !== now) continue;
    if (!top || r.floor > top.floor || (r.floor === top.floor && r.time < top.time)) top = r;
  }
  return top;
}

const fmtDate = (iso: string) => (lang() === 'en' ? iso.slice(5, 10).replace('-', '/') : `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.`);

export function RecordsScreen({ records, onBack }: { records: Records; onBack: () => void }) {
  const [tab, setTab] = useState<Period | 'mine'>(TABS[0]);
  const [boards, setBoards] = useState<Record<string, Board | 'error' | undefined>>({});
  useEffect(() => {
    // A board stays a minute; coming back to a tab after that fetches it again.
    const b = boards[tab];
    if (tab === 'mine' || (b && (b === 'error' || Date.now() - Date.parse(b.updated) < 60_000))) return;
    let live = true;
    fetchBoard(tab)
      .then((b) => live && setBoards((o) => ({ ...o, [tab]: b })))
      .catch(() => live && setBoards((o) => ({ ...o, [tab]: 'error' })));
    return () => {
      live = false;
    };
  }, [tab, boards]);
  const mine = loadInitials();
  const board = tab === 'mine' ? null : boards[tab];
  const list = board && board !== 'error' ? board.top : board;
  const myBest = tab === 'mine' ? null : myBestIn(tab, records.best);
  // Is my best already a row on the list? Same initials, floor and time is close enough.
  const myRow = myBest && Array.isArray(list) ? list.findIndex((e) => e.name === mine && e.floor === myBest.floor && Math.abs(e.time - Math.floor(myBest.time)) <= 1) : -1;
  // Off the list, my rank comes from the board's histogram, on this device.
  const myRank = myBest && board && board !== 'error' ? rankIn(board, myBest.floor) : null;
  return (
    <div className="screen" style={{ justifyContent: 'flex-start' }}>
      <h2>{RECORDS_ON ? tr('Tulostaulu', 'Leaderboard') : tr('Ennätykset', 'Records')}</h2>
      {TABS.length > 1 && (
        <div className="tabs">
          {TABS.map((x) => (
            <button key={x} className={'tab' + (tab === x ? ' on' : '')} onClick={() => setTab(x)} data-ui>
              {x === 'mine' ? tr('Omat', 'Mine') : PERIOD_LABELS[x]()}
            </button>
          ))}
        </div>
      )}
      {board && board !== 'error' && <p className="small updated">{updatedText(board.updated)}</p>}
      {tab !== 'mine' && list === undefined && <p className="small">{tr('Haetaan…', 'Loading…')}</p>}
      {tab !== 'mine' && list === 'error' && <p className="small">{tr('Tulostaulua ei saatu haettua.', 'The leaderboard did not load.')}</p>}
      {tab !== 'mine' && Array.isArray(list) && list.length === 0 && <p className="small">{tr('Ei vielä tuloksia. Ole ensimmäinen.', 'No runs yet. Be the first.')}</p>}
      {tab !== 'mine' && Array.isArray(list) && list.length > 0 && (
        <table className="records global">
          <thead>
            <tr>
              <th>#</th>
              <th>{tr('Nimi', 'Name')}</th>
              <th>{tr('Hahmo', 'Hero')}</th>
              <th className="n">{tr('Kerros', 'Floor')}</th>
              <th className="n">{tr('Aika', 'Time')}</th>
              <th className="n">{tr('Kaadot', 'Kills')}</th>
              {tab === 'all' && <th className="n">{tr('Pvm', 'Date')}</th>}
            </tr>
          </thead>
          <tbody>
            {list.map((e, i) => (
              <tr key={i} className={i === myRow ? 'me best' : e.name === mine ? 'me' : ''} title={`${e.bosses} ${tr('pomoa', 'bosses')}`}>
                <td>{i + 1}</td>
                <td className="name">{e.name}</td>
                <td>{heroName(e.hero)}</td>
                <td className="n">{e.floor}</td>
                <td className="n">{fmtTime(e.time)}</td>
                <td className="n">{num(e.kills)}</td>
                {tab === 'all' && <td className="n small">{fmtDate(e.at)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {tab !== 'mine' && Array.isArray(list) && myBest && myRow < 0 && (
        <table className="records global myrow">
          <tbody>
            <tr className="me best">
              <td>{myRank ?? '…'}</td>
              <td className="name">{mine || tr('Sinä', 'You')}</td>
              <td>{heroName(myBest.hero)}</td>
              <td className="n">{myBest.floor}</td>
              <td className="n">{fmtTime(myBest.time)}</td>
              <td className="n">{num(myBest.kills)}</td>
              {tab === 'all' && <td className="n small">{tr('oma paras', 'your best')}</td>}
            </tr>
          </tbody>
        </table>
      )}
      {tab !== 'mine' && (
        <p className="small">
          {tr(
            'Järjestys: kerros, sitten aika. Päivä vaihtuu keskiyöllä Suomen aikaa, viikko maanantaina. Oma paras korostettu; listan ulkopuolella se näkyy sijoineen alla.',
            'Ranked by floor, then time. The day changes at midnight Finnish time, the week on Monday. Your best is highlighted; when it is not on the list, it shows below with its rank.',
          )}
        </p>
      )}
      {tab === 'mine' && records.best.length === 0 && <p className="small">{tr('Ei vielä yhtään peliä.', 'No runs yet.')}</p>}
      {tab === 'mine' && records.best.length > 0 && (
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
                <td>{heroName(b.hero)}</td>
                <td className="n">{b.floor}</td>
                <td className="n">{fmtTime(b.time)}</td>
                <td className="n">{num(b.kills)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {tab === 'mine' && (
        <p className="small">
          {tr(`Pelejä ${records.runs}, kaatoja yhteensä ${num(records.totalKills)}.`, `${records.runs} runs, ${num(records.totalKills)} kills in all.`)}
        </p>
      )}
      <button className="btn ghost" onClick={onBack}>
        {tr('Takaisin', 'Back')}
      </button>
    </div>
  );
}
