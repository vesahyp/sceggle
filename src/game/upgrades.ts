import { COGS, type CogDef } from './content/cogs';
import type { Hero, HeroStats, SimState } from './state';

/** Derived numbers: the hero's base, the passive, then the cogs. */
export function computeStats(h: Hero): HeroStats {
  const c = (id: string) => h.cogs[id] ?? 0;
  const d = h.def;
  return {
    maxHp: d.hp + 25 * c('elinvoima'),
    speed: d.speed * (1 + 0.1 * c('saappaat')),
    armor: Math.min(0.7, d.armor + 0.1 * c('panssari')),
    reloadMul: d.reloadMul * Math.pow(0.82, c('lataus')),
    dmgMul: 1,
    rangeMul: 1 + 0.2 * c('tahtain'),
    bulletSpeedMul: 1 + 0.15 * c('tahtain'),
    superRate: 1 + 0.35 * c('varaaja'),
    luck: 0.4 * c('kulta'),
    magnet: 80 + 90 * c('magneetti'),
    extraAmmo: c('kattila'),
    pierce: c('lapaisy'),
    bounces: c('kimmoke'),
    count: c('monipiippu'),
    blastMul: d.blastMul,
    coinMul: 1 + 0.25 * c('kulta'),
  };
}

/** Three cogs to choose from on the lift. Ones you already have come up a little more often. */
export function rollCogs(s: SimState, h: Hero, n = 3): CogDef[] {
  const pool = COGS.filter((c) => (h.cogs[c.id] ?? 0) < c.max);
  const out: CogDef[] = [];
  const rng = s.rng;
  while (out.length < n && pool.length) {
    const pick = rng.weighted(pool, (c) => ((h.cogs[c.id] ?? 0) > 0 ? 1.4 : 1));
    out.push(pick);
    pool.splice(pool.indexOf(pick), 1);
  }
  return out;
}

export function applyCog(h: Hero, id: string): void {
  h.cogs[id] = (h.cogs[id] ?? 0) + 1;
  h.stats = computeStats(h);
  if (id === 'elinvoima') h.hp = h.stats.maxHp;
  for (const g of h.guns) g.ammo = Math.min(g.ammo, g.gun.ammo + h.stats.extraAmmo);
}
