/**
 * Seeded PRNG (mulberry32). One instance per run lives on the sim state, so a
 * seed reproduces a run exactly as long as the player input is the same. UI
 * code never draws from it; anything cosmetic uses its own stream.
 */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = hash32(seed);
    for (let i = 0; i < 4; i++) this.next();
  }
  /** [0, 1) */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }
  int(min: number, maxInclusive: number): number {
    return min + Math.floor(this.next() * (maxInclusive - min + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  /** Weighted pick; weights need not sum to 1. */
  weighted<T>(items: readonly T[], weight: (t: T) => number): T {
    let total = 0;
    for (const it of items) total += weight(it);
    let r = this.next() * total;
    for (const it of items) {
      r -= weight(it);
      if (r <= 0) return it;
    }
    return items[items.length - 1];
  }
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

export function hash32(x: number): number {
  let h = x | 0;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad);
  h = Math.imul(h ^ (h >>> 13), 0x735a2d97);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Deterministic 2D hash in [0,1) for world decoration. No state. */
export function hash2(x: number, y: number, salt = 0): number {
  return hash32((x * 73856093) ^ (y * 19349663) ^ (salt * 83492791)) / 4294967296;
}
