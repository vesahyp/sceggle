import * as ROT from 'rot-js';

/** splitmix32-style integer avalanche: neighbouring inputs land far apart. */
function hash32(x: number): number {
  let h = x | 0;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad);
  h = Math.imul(h ^ (h >>> 13), 0x735a2d97);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Seed the shared RNG stream. Always seed through here — never call
 * `ROT.RNG.setSeed` directly.
 *
 * rot.js's generator leaks its seed into its early output, and our seeds are
 * deliberately close together (`SEED + area`, `SEED * 31 + area`): raw, draw
 * #1 walks by ~0.0005 per seed, so anything decided on it is the same in
 * every area of a run — one of the reasons areas used to feel identical.
 * Hashing the seed first scatters neighbouring areas across the state space,
 * and a few burnt draws let the generator mix before anyone reads it.
 *
 * Determinism is unaffected: same seed → same hash → same stream.
 */
export function seedRng(seed: number): void {
  ROT.RNG.setSeed(hash32(seed));
  for (let i = 0; i < 4; i++) ROT.RNG.getUniform();
}
