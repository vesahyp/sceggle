import { newRun, step, nextFloor, DT } from '../src/game/sim';
import { HEROES, HERO_BY_ID } from '../src/game/content/heroes';
import { rollCogs, applyCog } from '../src/game/upgrades';
import { gunDps } from '../src/game/guns';
import { Rng } from '../src/game/rng';
import { botInput, botPickCog } from './autoplayer';
import { t } from '../src/i18n';

declare const process: { argv: string[]; exitCode?: number };

/**
 * npm run balance [floors] [runs] [hero]: bot runs, one line per run.
 * The bot is a floor, not a player; read the trend, not the number.
 */
const maxFloor = Number(process.argv[2] ?? 15);
const runs = Number(process.argv[3] ?? 2);
const only = process.argv[4];
const heroes = only ? [HERO_BY_ID[only]] : HEROES;

for (const def of heroes) {
  for (let r = 0; r < runs; r++) {
    const seed = 1000 + r * 7 + def.id.length;
    const s = newRun(seed, [def]);
    const bot = new Rng(seed ^ 0x5151);
    const floorTimes: number[] = [];
    let last = 0;
    const t0 = performance.now();
    while (!s.gameOver && s.floor <= maxFloor && s.time < 60 * 60) {
      step(s, s.heroes.map((h) => botInput(s, h, bot)), DT);
      if (s.phase === 'done') {
        for (const h of s.heroes) {
          for (let k = 0; k < s.pendingCogs; k++) applyCog(h, botPickCog(rollCogs(s, h), bot).id);
        }
        s.pendingCogs = 0;
        floorTimes.push(Math.round(s.time - last));
        last = s.time;
        if (s.floor === maxFloor) break;
        nextFloor(s);
      }
      // Stuck guard: a floor that takes four minutes is a bug, not a fight.
      if (s.floorTime > 240) {
        console.log(`  stuck on floor ${s.floor}: phase ${s.phase}, waves left ${s.wavesLeft}, hero ${Math.round(s.heroes[0].x)},${Math.round(s.heroes[0].y)}; ` + s.enemies.map((e) => `${e.kind} ${Math.round(e.x)},${Math.round(e.y)} hp ${Math.round(e.hp)} ${e.mode}`).join("; "));
        break;
      }
    }
    const h = s.heroes[0];
    const ms = performance.now() - t0;
    console.log(
      `${def.id.padEnd(12)} seed ${seed}: floor ${s.floor}${s.gameOver ? ' died' : ''} ${Math.round(s.time)}s kills ${s.run.kills} coins ${s.run.coins} guns ${s.run.guns} best ${s.run.bestRarity} | ${h.guns.map((g) => `${t(g.gun.name)} r${g.gun.rarity} L${g.gun.level} dps ${Math.round(gunDps(g.gun))}`).join(' + ')} | floors ${floorTimes.join(',')} | ${Math.round(ms)}ms`,
    );
  }
}
