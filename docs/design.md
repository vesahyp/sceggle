# Höyry: the design

The reboot of sceggle, written 2026-10-02. The old game had the parts
(looted guns, cogs, grass that hides you, barrels that chain) but no reason
to keep playing: a slow sneak across one field with grey boxes for art. This
design keeps those parts and puts them in a loop that pays out every minute.

Four sources, one job each:

| Source | What it gives the game |
|--------|------------------------|
| Brawl Stars | The hands. Two thumbs, tap to auto-aim, drag to aim, ammo in three segments that refill, a super that charges when you hit. Short rounds. Bushes to hide in. |
| Borderlands | The guns. Every gun is rolled from a maker, a type and a rarity. The maker decides how it behaves, so a gun is a character, not a row of numbers. Some guns are plainly wrong in a good way. |
| Diablo | The pace of loot and the descent. Enemies burst into drops, rarity has a colour and a light beam, and the run goes down one floor at a time to a boss. |
| Steampunk | The world. Brass, soot, red brick and steam. Tampere in 1899, the mill town on the rapids, where the machines in the works woke up one night. |

## Name

**Höyry**, Finnish for steam. Short and Finnish, like Räkkä beside it. The
game is in Finnish and English, chosen from the browser, the same as Räkkä.

## The loop

A run is a descent through the works, floor by floor.

1. **A floor** is one arena, about two screens wide. Enemies come in two or
   three waves. Kill the last one and the lift opens. A floor takes 45 to 90
   seconds.
2. **Loot** drops all the time: guns, coins, steam (health). Every drop has
   its rarity colour, and better drops stand in a beam of light that shows
   from off the screen.
3. **The lift** is the only pause. Ride it and pick one of three **cogs**:
   perks that change a rule (every 5th shot ricochets, kills vent steam that
   heals, the super charges twice as fast). Then the next floor.
4. **Every fifth floor** is a boss. Every boss drops a gun of purple rarity
   or higher.
5. **Death ends the run.** The score is the deepest floor, then the time.
   Coins go home to the workshop, which buys small permanent ranks (Räkkä's
   Tapion pöytä, recast as a workbench).

Short floors mean a phone game can stop at any lift. Endless depth means the
good run has no ceiling.

## The hands

On a phone: the left half of the screen is the move stick, the right half is
the gun.

- **Tap** the right side: fire at the nearest enemy you can see.
- **Drag** the right side: an aim line shows, release fires along it.
- **The super button** sits above the right thumb. It fills as your shots
  land. Tap to auto-aim, drag to aim, the same as the gun.
- **The swap button** changes between your two guns.
- **Walk over a gun** to see its card beside the one you hold. Tap the card
  to take it; the old gun drops.

On a keyboard: WASD to walk, the mouse to aim, click to fire (hold to keep
firing), space or right click for the super, Q to swap, E to pick up.

Ammo is three segments. Each shot uses one, each refills on the gun's own
reload time. Firing is free while moving; kiting is the whole fight.

## Guns

A gun = **type** × **maker** × **rarity**, plus a name made from all three.

**Types** decide the shape of the shot:

| Type | Shot |
|------|------|
| Revolver | one fast bullet, good range |
| Scattergun | a fan of pellets, short range, hard close up |
| Rifle | a long thin shot that pierces |
| Mortar | lobs over walls and lands where you aim; bursts |
| Steam lance | a short cone that hits everything in it, scalds |
| Sawblade | a disc that ricochets off walls |

**Makers** decide the behaviour. Each has a colour and a rule:

| Maker | Rule |
|-------|------|
| Paukku & Poika | Big damage, slow, two segments. No tricks. |
| Kipinä | Shots carry an element: fire burns, tesla chains, frost slows. |
| Rattaanpää | Fires faster the longer you hold. Five segments. |
| Heittola | When the ammo is gone you throw the gun. It explodes, and a fresh one appears in your hand. |
| Torpeedo | Every shot explodes. Every one. |
| Kellosepät | Clockwork shots that turn toward the enemy. |

**Rarity** sets the stat budget and the number of extra parts: grey, green,
blue, purple, orange. **Orange guns are named and break a rule**: the
Kahvipannu fires coffee that heals you, the Käkikello fires a cuckoo every
twelfth shot that will not stop chasing, Mummon sateenvarjo blocks shots
while you are not firing.

Enemies carry guns from the same table and drop them. What shot at you is
what you take.

## Heroes

Four to start, each with a starting gun type, a passive and a super. The
super is the Brawl Stars part: it is what you save for and what you remember.

| Hero | Super |
|------|-------|
| Nuohooja (chimney sweep) | dashes, leaving a soot cloud that blinds what is inside it |
| Konemestari (engineer) | sets down a turret that fires the same gun as you |
| Ilmalaivuri (aeronaut) | jumps across the arena and lands with a stomp |
| Seppä (smith) | a ground slam that throws enemies back, and a shield for a few seconds |

## The arena

Generated per floor from the seed. Brick walls and pipes block movement and
shots. Crates block until they are shot apart. Barrels explode and chain.
Bushes (here, tall weeds through the floor grates) hide anything inside them
until it fires or comes close. Steam vents puff on a timer and scald.

## Enemies

Every enemy attack is slow enough to see and dodge. That is the rule that
makes a twin-stick game fair: an enemy shot is a large slow orb, a mortar
shows its landing circle before it lands, a charger winds up.

The cast is the works come alive: cog rats in swarms, rivet gunners, boiler
brutes that charge, mortar crews, bomb walkers that run at you and burst,
turret towers. Elites have a gold ring and a name built from affixes (Nopea,
Panssaroitu, Räjähtävä). Bosses have a name and a pattern.

## What carries over from Räkkä

The architecture, because it is proven on a phone: Canvas 2D with sprites
drawn once by code, a headless sim at a fixed step, seeded RNG, a bot that
drives the real sim for `sim-check` and `balance`, Playwright screenshots,
both languages from the first commit. See ADR 0001.

## What is left out of the first version

Co-op, the global leaderboard, the workshop meta and portal builds. Each one
exists in Räkkä and can be copied once the loop is good.
