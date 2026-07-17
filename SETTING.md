# The Long Dark — Setting Bible

The world of **sceggle**. This is the source of truth for lore, tone, and how
the game's core systems are dressed. It's written to be *usable*: every piece of
fiction here maps to something we build. Keep it in sync as the design evolves.

> **Logline.** The sun went out. In the endless cold that followed, the last
> people huddle around mortal fires while the Cold's court closes in. You are a
> drifter carrying one stubborn coal — walking out into the dark to rekindle a
> world that has mostly given up.

---

## 1. The Guttering

The sun was the first and largest fire. One winter it **guttered** — not an
eclipse, not a slow dimming, but a candle pinched out between two fingers. There
was a last red evening, and then there was the Long Dark, and it has not lifted
since. No one alive remembers warmth from the sky.

What remains is **the Cold** — not merely low temperature but an appetite. The
Cold wants stillness: unmoving water, unbeaten hearts, unlit hearths. Where it
settles long enough, things *forget* — people forget names, animals forget fear,
stone forgets which way was up. The deep places of the world are where the Cold
has been thinking the longest, and they are strange.

Against it stand **fires** — every mortal flame is now an act of defiance. A lit
hearth is a small territory the Cold cannot enter. This is the whole physics of
the world: **light is life, warmth is will, and the dark forgets you.**

## 2. The Frostmother and her Court

The Cold has a shape, or has grown one. The folk call her the **Frostmother** —
sovereign of the guttered world, who rules by patience. She does not attack; she
*waits*, and sends her Court to hurry things along:

- **The Hushed** — people the Cold has finished forgetting. They move slowly,
  then not at all, then all at once when you come near a fire they remember
  wanting.
- **Rimewights** — animals grown a second skin of ice; brittle, fast, and drawn
  to heartbeat and flame.
- **The Lanternless** — former drifters like you, whose coal went out. They still
  walk the roads looking for a light to take.
- **Court proper** — the Frostmother's named things (act bosses): the Weir Widow
  in the drowned marsh, the Antler Saint in the black forest, and at the end,
  the Frostmother's own throne of stopped water.

The Court is not evil so much as *thermodynamic*. It is the dark being what the
dark is.

## 3. You, the Drifter

You are **no one in particular** — a nameless traveller who walked in out of the
snow. That is deliberate: you are a vessel the player fills.

The one thing that makes you exceptional is **your coal** — a single ember you
keep against your chest that will not fully die. It is why you can go where lit
folk cannot, and it is why **death is not the end**: when you fall, the coal
finds a rekindled beacon and draws you back to it, a little dimmer. This is the
diegetic frame for roguelike revival — *you are hard to put out, not immortal.*

Your coal is also the seam that connects every system below: the same light you
burn to survive is the light you socket into gear and feed to hungry weapons.

## 4. The Shape of the World

Structure is **Diablo II, not NetHack**: a lit hub, and acts you travel *out*
into (the world spreads outward from fire into dark, rather than only downward).

- **Emberwatch** — the hub. The last town with a living Great Hearth. Smiths,
  a light-cutter, survivors, and the beacon you return to when you fall.
- **Acts / regions** — themed frozen biomes, each a chapter of pushing the light
  outward: the **Drowned Marsh**, the **Black Forest**, the **Glass Reach**
  (a frozen sea), and the **Stillheart** (the Frostmother's palace of stopped
  water). Each act ends at a Court boss.
- **Wardlights** — dead beacons scattered through the dark. **Rekindling** one
  makes it a fast-travel point and a safe island of warmth. These are our
  **waypoints** (D2) and our checkpoints (soft death): light you have restored
  to the map, literally.

## 5. Light Is the One Currency

The central economy. Light is not an abstract number on a HUD — it is the
*substance* the whole world runs on, and it does three jobs:

1. **It keeps you alive** — your coal, and the beacons you rekindle.
2. **It powers your gear** — crystallized light (**embers**) socketed into
   weapons and garb. *(The Diablo gem system — see §6.)*
3. **It fuels what you build** — some constructed weapons *burn* light to do
   their work. *(The Borderlands construction system — see §7.)*

Because it is one resource with three uses, every choice trades against the
others: an ember socketed for power is an ember not banked against the dark.
That tension is the game's spine.

---

## 6. Emberwork — sockets & embers *(the Diablo gem system)*

Slivers of the guttered sun still fall as **embers** — hard little coals of
trapped light, each burning a different hue. Gear with **sockets** can hold them;
the **light-cutter** in Emberwatch sets, pries, and fuses them.

This is the Diablo socket/gem loop, reskinned: *find embers, slot them, fuse
lesser into greater, chase build-defining hues.*

### Emberkinds

Each hue is a memory of a different quality of the lost sun:

| Ember | Hue | What it grants |
|---|---|---|
| **Coalfire** | red | burning-over-time; a warmth aura that holds the Cold back |
| **Witchfire** | blue | cold-bane: slows and makes the Court's ice brittle (bonus vs. Rimewights) |
| **Goldgleam** | gold | fortune — better ember/part drops; reveals nearby light in the dark |
| **Foxfire** | green | slow life regeneration; your coal dims more slowly |
| **Duskglass** | violet-black | forbidden. Great power that grows as your coal dims — risk/reward |

### Tiers & fusing

Four sizes: **Chip → Shard → Ember → Heart.** The light-cutter fuses **three of a
kind, one tier up** (the D2-cube recipe). A **Heart** ember is build-defining and
rare. Effects scale by tier.

### Sockets

- Weapons, **garb** (armor), and **charms** carry 0–3 sockets; socket count is a
  function of rarity and the weapon's **Core** part (§7).
- Some gear has **linked sockets** — matching hues in linked slots grant a set
  bonus (e.g. two Witchfire → "shatter": brittle enemies explode on death).
- Duskglass in any socket marks the gear (and you) as *dimming* — stronger, but
  the Court notices.

## 7. Forgework — weapon construction *(the Borderlands part system)*

The old great forges died with the sun; there is no mass-making anymore. Every
weapon now is **assembled** from scavenged parts over a captured-ember heat, and
no two are quite alike. This is the Borderlands procedural-gun fantasy, melee-first:
*a weapon is the sum of its parts and its maker's signature.*

### Parts

A weapon = four parts + rolled affixes + sockets:

| Part | Governs (maps to code) |
|---|---|
| **Head** | damage type + knockback profile — cleave / spike / maul → `weight`, arc width |
| **Haft** | reach & swing speed → `reach`, swing duration |
| **Binding** | handling — stagger, crit, recovery |
| **Core** | special behavior + **how many ember sockets** the weapon has |

Because `weight → knockback` and the swing arc are already in the engine
(`weapons.ts`, `systems.performAttack`), the **Head** part is the first thing we
can actually generate; the rest layer on.

### Maker-traditions *(the "manufacturer" identities)*

Like Borderlands manufacturers, each maker has a **feel** and a **signature quirk**,
so you learn to read a weapon by who made it:

| Maker | Feel | Signature quirk |
|---|---|---|
| **Marrowkith** (bone clans) | brutal, slow, huge knockback | kills send a bonebreak shockwave that knocks back everything near the corpse |
| **Thawwrights** (tinker-smiths) | fast, precise, ember-hungry | *burns* socketed light on hit for bonus effects — power for fuel |
| **Cindermongers** | aggressive, hot | ships with a bound Coalfire core; heat/damage ramps on consecutive hits |
| **Wardwrights** (village smiths) | reliable, balanced, cheap | passive warmth aura; safe, forgiving handling |
| **Hollow-forged** (scavenged from the Court) | powerful, cursed | grows stronger the dimmer your coal — the dark's own weapons |

### Rarity

Rarity gates part quality, affix count, and sockets: **Kindled → Warded →
Beaconforged → Hearthrelic** (common → legendary). A **Hearthrelic** is a named,
fixed-signature weapon (D2 "unique"), often a Court trophy.

## 8. How the two systems mesh

They are not two minigames — they share the **Core** part and the **light**
economy:

- **Forgework builds the frame**, and a weapon's **Core** decides its **ember
  sockets** — so a great weapon is worthless without embers to fill it, and great
  embers want a good frame.
- **Emberwork tunes the frame** — the same embers can go in weapon, garb, or
  charm, so builds are about *where* you spend a finite supply of light.
- **Your coal is the shared stake** — Thawwright weapons burn light, Duskglass
  and Hollow-forged gear feed on your dimming, and every ember socketed is one not
  kept in reserve. Power always trades against warmth.

One resource, three uses, constant tension. That's the design in a sentence.

---

## 9. Tone & pillars

- **Cold, not gore.** Folk-horror and fairy-tale dread — the quiet of a frozen
  lake, not splatter. Beauty in the desolation.
- **Warmth is the reward.** Rekindling a wardlight should feel like relief. The
  game is about pushing light into the dark and the cost of doing so.
- **You are small.** The Frostmother is not a foe you trade blows with early; the
  dark is the antagonist and it is winning. Hope is earned in inches.
- **Legibility over spectacle.** Placeholders are fine (see `CLAUDE.md`); a
  reader should always know what hit them and which way they swung.
- **Everything trades against light.** If a system doesn't touch the light
  economy, question whether it belongs.

## 10. Mapping to the build

Where the fiction meets the code today, and the path forward:

- **Exists now:** real-time directional combat with weight-scaled knockback
  (`systems.performAttack`), aim/swing (`scene/Player.tsx`), a seeded region
  generator (`dungeon.ts`), and a chasing enemy (the goblin is a stand-in
  **Hushed**).
- **Nearest fiction-bearing steps** (see `ROADMAP.md`):
  1. **Combat loop** — the Court fights back and can be put down (item ②).
  2. **Emberwork v0** — add a `sockets`/`embers` component and one ember effect
     (Coalfire warmth or Witchfire slow). Light becomes a resource.
  3. **Forgework v0** — generate a weapon's **Head** part (damage/knockback
     profile) so drops vary; introduce one maker quirk.
  4. **Wardlights** — rekindle-able beacons as waypoints + soft-death checkpoints.
- **Vocabulary to reuse in code:** Emberwatch (hub), wardlight (waypoint), coal
  (player light/revive), ember (gem), Head/Haft/Binding/Core (weapon parts),
  maker (manufacturer), Hushed/Rimewight/Lanternless (early enemies).
