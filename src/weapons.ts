/**
 * Weapon definitions.
 *
 * A weapon is plain data. `weight` drives the knockback impulse applied to
 * whatever it hits; `reach` is how far the swing lands; `color`/`length`/
 * `blade` shape the little mesh held in the entity's hand. Because this is
 * just data, "switching weapons on a mob" is a one-line component swap
 * (see ecs.ts) — no imperative mesh juggling.
 */
export interface WeaponDef {
  id: string;
  name: string;
  /** Knockback impulse magnitude applied on hit. Heavier = bigger shove. */
  weight: number;
  /** Attack range in world units. */
  reach: number;
  /** Held-mesh tint. */
  color: string;
  /** Held-mesh blade length. */
  length: number;
  /** Held-mesh blade thickness. */
  thickness: number;
}

export const WEAPONS: WeaponDef[] = [
  { id: 'dagger', name: 'Dagger', weight: 3, reach: 1.1, color: '#cbd5e1', length: 0.5, thickness: 0.06 },
  { id: 'longsword', name: 'Longsword', weight: 8, reach: 1.5, color: '#e2e8f0', length: 1.0, thickness: 0.08 },
  { id: 'warhammer', name: 'Warhammer', weight: 20, reach: 1.3, color: '#94a3b8', length: 0.8, thickness: 0.22 },
];

export const WEAPON_BY_ID = new Map(WEAPONS.map((w) => [w.id, w]));

/** Return the weapon after `current` in the list, wrapping around. */
export function nextWeapon(current: WeaponDef): WeaponDef {
  const i = WEAPONS.findIndex((w) => w.id === current.id);
  return WEAPONS[(i + 1) % WEAPONS.length];
}
