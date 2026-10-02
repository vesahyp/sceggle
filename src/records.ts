/**
 * Local records: one JSON blob in localStorage. Every finished run folds
 * into a top-ten list ranked by floor, then by time, plus per-hero bests and
 * lifetime totals. Nothing leaves the device but the tracker beacons.
 */
export interface RunRecord {
  hero: string;
  floor: number;
  time: number;
  kills: number;
  coins: number;
  bestGun: string;
  bestRarity: number;
  date: string;
}

export interface Records {
  runs: number;
  best: RunRecord[];
  perHero: Record<string, { floor: number; kills: number }>;
  totalKills: number;
  deepest: number;
}

const KEY = 'hoyry.records.v1';

export function loadRecords(): Records {
  const empty: Records = { runs: 0, best: [], perHero: {}, totalKills: 0, deepest: 0 };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...empty, ...JSON.parse(raw) };
  } catch {
    /* private mode: play without records */
  }
  return empty;
}

export function saveRun(r: RunRecord): { records: Records; rank: number; heroBest: boolean } {
  const rec = loadRecords();
  rec.runs++;
  rec.totalKills += r.kills;
  rec.deepest = Math.max(rec.deepest, r.floor);
  rec.best.push(r);
  rec.best.sort((a, b) => b.floor - a.floor || a.time - b.time);
  const rank = rec.best.indexOf(r);
  rec.best = rec.best.slice(0, 10);
  const ph = rec.perHero[r.hero] ?? { floor: 0, kills: 0 };
  const heroBest = r.floor > ph.floor;
  rec.perHero[r.hero] = { floor: Math.max(ph.floor, r.floor), kills: Math.max(ph.kills, r.kills) };
  try {
    localStorage.setItem(KEY, JSON.stringify(rec));
  } catch {
    /* see loadRecords */
  }
  return { records: rec, rank: rank < 10 ? rank : -1, heroBest };
}

export function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function track(event: string, data: Record<string, unknown> = {}): void {
  const w = window as unknown as { __clvtracker?: { track?: (e: string, d: Record<string, unknown>) => void } };
  try {
    w.__clvtracker?.track?.(event, data);
  } catch {
    /* tracker is optional */
  }
}
