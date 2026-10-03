/**
 * The global records API: one Lambda behind an HTTP API (infra/records.tf),
 * Räkkä's with floors in place of seconds (docs/adr/0002-own-records-api.md).
 * Names are three characters like a pinball table. Every call is best
 * effort: the game never waits on it and the local records stay the
 * fallback when the network is away. The URLs come from src/config.ts; a
 * build without them has no global records at all.
 */
import { tr } from './i18n';
import { BOARD_URL, RECORDS_API, RECORDS_ON } from './config';

export { RECORDS_ON };

export type Period = 'day' | 'week' | 'month' | 'all';

export interface TopEntry {
  name: string;
  hero: string;
  floor: number;
  time: number;
  kills: number;
  coins: number;
  bosses: number;
  at: string;
  /** the guns held at the end, as type:maker:rarity[:legend]; absent when the client sent none */
  guns?: string[];
}

export const PERIOD_LABELS: Record<Period, () => string> = {
  day: () => tr('Tänään', 'Today'),
  week: () => tr('Viikko', 'Week'),
  month: () => tr('Kuukausi', 'Month'),
  all: () => tr('Kaikki', 'All time'),
};

export interface Board {
  top: TopEntry[];
  /** runs per floor reached in the period, for ranks on the device */
  hist: Record<string, number>;
  /** when the server built this answer; the cache can hold it a minute */
  updated: string;
}

export async function fetchBoard(period: Period): Promise<Board> {
  if (!RECORDS_ON) throw new Error('records off');
  const r = await fetch(`${BOARD_URL}?period=${period}`);
  if (!r.ok) throw new Error(`board ${r.status}`);
  const j = (await r.json()) as Board;
  // The API orders by floor, then the shorter time; equal runs go to the one with more kills.
  j.top.sort((a, b) => b.floor - a.floor || a.time - b.time || b.kills - a.kills);
  return j;
}

/** The rank a floor holds in a board: 1 + the runs that went deeper. Equal floors share a rank. */
export function rankIn(board: Board, floor: number): number {
  let above = 0;
  for (const [f, n] of Object.entries(board.hist)) if (Number(f) > floor) above += n;
  return above + 1;
}

export async function submitScore(s: { name: string; hero: string; floor: number; time: number; kills: number; coins: number; bosses: number; guns: string[] }): Promise<Record<Period, number>> {
  if (!RECORDS_ON) throw new Error('records off');
  const r = await fetch(`${RECORDS_API}/scores`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...s, time: Math.floor(s.time) }),
  });
  if (!r.ok) throw new Error(`scores ${r.status}`);
  const j = (await r.json()) as { ranks: Record<Period, number> };
  return j.ranks;
}

const NAME_KEY = 'hoyry.initials';
export function loadInitials(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}
export function saveInitials(n: string): void {
  try {
    localStorage.setItem(NAME_KEY, n);
  } catch {
    /* fine */
  }
}
