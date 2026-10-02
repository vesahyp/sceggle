import { t, tr } from '../i18n';
import { LEGENDS } from '../game/content/legends';
import type { CogDef } from '../game/content/cogs';
import { gunDps, MAKER_INFO, RARITY_COLOR, RARITY_NAME, TYPE_NAME } from '../game/guns';
import type { Gun } from '../game/types';

const ELEMENT_NAME = { fire: () => tr('tuli', 'fire'), shock: () => tr('sähkö', 'shock'), frost: () => tr('pakkanen', 'frost'), none: () => '' };

/** The lines that say what a gun does beyond its numbers. */
export function gunTraits(g: Gun): string[] {
  const out: string[] = [];
  if (g.legend) out.push(t(LEGENDS[g.legend].rule));
  out.push(t(MAKER_INFO[g.maker].rule));
  if (g.element !== 'none' && g.maker !== 'kipina') out.push(tr(`Alkuaine: ${ELEMENT_NAME[g.element]()}.`, `Element: ${ELEMENT_NAME[g.element]()}.`));
  if (g.maker === 'kipina') out.push(tr(`Tämä: ${ELEMENT_NAME[g.element]()}.`, `This one: ${ELEMENT_NAME[g.element]()}.`));
  if (g.pierce > 0 && g.pierce < 50 && g.type !== 'lance') out.push(tr(`Läpäisee ${g.pierce}.`, `Pierces ${g.pierce}.`));
  if (g.bounces > 0 && g.type !== 'saw') out.push(tr(`Kimpoaa ${g.bounces}.`, `Bounces ${g.bounces}.`));
  if (g.blast > 0 && g.type !== 'mortar' && g.maker !== 'torpeedo') out.push(tr('Räjähtää.', 'Explodes.'));
  return out;
}

function Stat({ label, v, cmp, better = 'high', fmt = (x: number) => String(Math.round(x)) }: { label: string; v: number; cmp?: number; better?: 'high' | 'low'; fmt?: (x: number) => string }) {
  let cls = '';
  if (cmp !== undefined && Math.abs(v - cmp) > Math.abs(cmp) * 0.02) {
    const up = v > cmp;
    cls = (better === 'high') === up ? 'up' : 'down';
  }
  return (
    <div className={`stat ${cls}`}>
      <span>{label}</span>
      <b>
        {fmt(v)}
        {cls === 'up' ? ' ▲' : cls === 'down' ? ' ▼' : ''}
      </b>
    </div>
  );
}

export function GunCard({ g, vs, compact = false }: { g: Gun; vs?: Gun; compact?: boolean }) {
  const col = RARITY_COLOR[g.rarity];
  const perShot = g.damage * g.count * g.burst;
  return (
    <div className={`gun r${g.rarity} ${compact ? 'compact' : ''}`} style={{ borderColor: col }}>
      <div className="gname" style={{ color: col }}>
        {t(g.name)}
      </div>
      <div className="gsub">
        {t(RARITY_NAME[g.rarity])} · {MAKER_INFO[g.maker].name} · {t(TYPE_NAME[g.type])} · {tr('taso', 'level')} {g.level}
      </div>
      {!compact && (
        <>
          <div className="gstats">
            <Stat label={tr('Teho', 'DPS')} v={gunDps(g)} cmp={vs && gunDps(vs)} />
            <Stat label={tr('Laukaus', 'Per shot')} v={perShot} cmp={vs && vs.damage * vs.count * vs.burst} />
            <Stat label={tr('Lippaat', 'Ammo')} v={g.ammo} cmp={vs?.ammo} />
            <Stat label={tr('Lataus', 'Reload')} v={g.reload} cmp={vs?.reload} better="low" fmt={(x) => `${x.toFixed(2)} s`} />
            <Stat label={tr('Kantama', 'Range')} v={g.range} cmp={vs?.range} />
          </div>
          <ul className="traits">
            {gunTraits(g).map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function CogCard({ c, level, onPick }: { c: CogDef; level: number; onPick: () => void }) {
  return (
    <button className={`card ${level > 0 ? 'owned' : 'new'}`} onClick={onPick}>
      <div className="ic">{c.icon}</div>
      <div className="body">
        <div className="name">
          {t(c.name)}
          <span className="lvl">{level > 0 ? `${level} → ${level + 1}` : tr('Uusi', 'New')}</span>
        </div>
        <div className="desc">{t(c.desc(level + 1))}</div>
      </div>
    </button>
  );
}
