# Reboot working notes

Working state of the Höyry reboot (2026-10-02), so a session or subagent can
pick it up cold. Delete this file when the reboot merges to `master`.

## Where things are

- Branch `reboot`, pushed. `master` still serves the old game. Merge when
  the new game beats it.
- Design: `docs/design.md`. Architecture decision: `docs/adr/0001-*.md`.
- Sim (headless, no DOM): `src/game/` — `arena.ts` (map gen, collision,
  walk field), `guns.ts` (gun rolls), `weapons.ts` (firing, projectiles,
  zones), `combat.ts` (hurt, explode, kill, drops), `sim.ts` (step, heroes,
  supers, enemy AI, bosses, waves, lift), `upgrades.ts` (stats, cogs),
  `content/` (heroes, enemies, cogs, legends).
- View: `src/render/renderer.ts` (3/4 view, row-sorted walls),
  `src/render/sprites.ts` (procedural sprites), `src/input/input.ts`
  (twin stick + mouse), `src/ui/` (Game loop + HUD, Screens, Cards),
  `src/audio.ts`.
- Tools: `npm run balance [floors] [runs] [hero]` (bot), `tools/autoplayer.ts`,
  `tools/dbg/stuck.ts` (map dump for a stuck floor; not committed),
  `scripts/shots.mjs` (Playwright, iPhone 15, `?bot=1&speed=3&seed=`).

## Done

1. Design + ADR (committed).
2. Sim + bot (committed). Bot reaches floor 4 to 10.
3. Renderer, input, UI, audio, styles, index.html (typechecks; not yet
   committed). First screenshots taken into `shots/`; not reviewed yet.

## Next slices (in order)

1. Review screenshots, fix what looks wrong, commit the view slice.
2. `tools/sim-check.ts` + Makefile (`dev`, `check`, `balance`, `shots`),
   CLAUDE.md rewrite for the new code, README in player words.
3. Balance pass with the bot: early deaths on floor 2 to 4 (Konemestari,
   Seppä), floor length 15 to 45 s.
4. Feel pass: hit stop, kill pops, screen shake tuning, gun pickup flow on
   touch.
5. Merge to `master`, update `jeeves/projects/sceggle.md`.
6. Later: workshop meta (coins), co-op, leaderboard (copy from Räkkä).

## Rules the user set for this work

- Subagents build, one slice at a time, Sonnet. The lead reviews every
  diff, runs the checks and commits. Parallel fan-out is off.
- Images are read by cheap subagents, never in the lead's context.
- Commit and push at every slice boundary.
