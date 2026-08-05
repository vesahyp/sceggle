import { describeMechanism, type MechanismDef, type WeaponDef } from './weapons';

/** Rough sustained damage — the one number that makes drops comparable. */
const dps = (w: WeaponDef) => (w.damage * w.rate * w.count).toFixed(1);

/**
 * The pack: plain React DOM beside the canvas (the DOM-alongside-canvas
 * payoff). Pickups land here; the player equips, installs cogs into the
 * equipped weapon's fittings, and discards clutter. Nothing in the panel
 * touches the sim directly — every action flows through App's state, which
 * mirrors into the ECS.
 */
export function Inventory({
  weapons,
  parts,
  equippedId,
  onEquip,
  onDiscardWeapon,
  onInstall,
  onDiscardPart,
}: {
  weapons: WeaponDef[];
  parts: MechanismDef[];
  equippedId: string;
  onEquip: (id: string) => void;
  onDiscardWeapon: (id: string) => void;
  onInstall: (part: MechanismDef) => void;
  onDiscardPart: (id: string) => void;
}) {
  const held = weapons.find((w) => w.id === equippedId);
  const equippedFull = !!held && held.mechanisms.length >= held.slots;
  return (
    <div className="inventory">
      <h2>Pack</h2>
      <p className="inv-hint">click a gun to equip it</p>
      {weapons.map((w) => {
        const equipped = w.id === equippedId;
        return (
          <div
            key={w.id}
            className={`inv-item${equipped ? ' equipped' : ''}`}
            onClick={() => onEquip(w.id)}
          >
            <div className="inv-head">
              <b style={{ color: w.color }}>{w.name}</b>
              <span className="inv-dps">~{dps(w)} dps</span>
              {!equipped && (
                <button
                  className="inv-x"
                  title="discard"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDiscardWeapon(w.id);
                  }}
                >
                  ✕
                </button>
              )}
            </div>
            <div className="inv-stats">
              dmg {w.damage} · {w.rate}/s · range {w.reach}
              {w.count > 1 ? ` · ×${w.count} shots` : ''}
              {w.pierce ? ' · pierce' : ''}
              {w.blastRadius > 0 ? ` · blast ${w.blastRadius}` : ''} · kb {w.knockback}
            </div>
            <div className="inv-fittings">
              {w.mechanisms.map((m) => (
                <span
                  key={m.id}
                  className="chip"
                  title={describeMechanism(m)}
                  style={{ borderColor: m.color, color: m.color }}
                >
                  {m.type} {m.power}
                </span>
              ))}
              {Array.from({ length: Math.max(0, w.slots - w.mechanisms.length) }, (_, i) => (
                <span key={`free-${i}`} className="chip chip-empty">
                  empty
                </span>
              ))}
            </div>
            {/* Installed cogs change what the gun DOES — say so on the card,
                or an install reads as the cog simply vanishing. */}
            {w.mechanisms.length > 0 && (
              <ul className="inv-effects">
                {w.mechanisms.map((m) => (
                  <li key={m.id} style={{ color: m.color }}>
                    {describeMechanism(m)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}

      <h2>Cogs</h2>
      <p className="inv-hint">
        click to install into the equipped gun
        {equippedFull ? ' — its fittings are full, so the oldest cog swaps back here' : ''}
      </p>
      <div className="inv-parts">
        {parts.map((p) => (
          <span
            key={p.id}
            className="chip chip-click"
            title={describeMechanism(p)}
            style={{ borderColor: p.color, color: p.color }}
            onClick={() => onInstall(p)}
          >
            {p.type} {p.power}
            <button
              className="inv-x"
              title="discard"
              onClick={(e) => {
                e.stopPropagation();
                onDiscardPart(p.id);
              }}
            >
              ✕
            </button>
          </span>
        ))}
        {parts.length === 0 && <span className="inv-hint">none — mobs drop them</span>}
      </div>
    </div>
  );
}
