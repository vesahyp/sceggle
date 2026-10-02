// Phone screenshots of the game, repeatable: title, hero select, a run at
// a few points with the bot playing, and the death screen. Run
// `make shots-setup` once, then `make shots`. Starts its own dev server on
// port 5199. `node scripts/shots.mjs en` takes the English set into shots/en/.
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const port = 5199;
const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const lang = process.argv[2] === 'en' ? 'en' : 'fi';
const dir = lang === 'en' ? 'shots/en' : 'shots';
const say = (fi, en) => (lang === 'en' ? en : fi);
mkdirSync(dir, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 15'], hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const shot = (name) => page.screenshot({ path: `${dir}/${name}.png` });

try {
  await page.goto(`http://localhost:${port}/?bot=1&speed=3&seed=4242&lang=${lang}`);
  await shot('01-title');
  await page.getByRole('button', { name: say('Pelaa', 'Play'), exact: true }).click();
  await page.waitForTimeout(300);
  await shot('02-select');
  await page.getByRole('button', { name: new RegExp(say('Konemestari', 'The Engineer')) }).click();
  const at = async (sec, name) => {
    await page.waitForFunction((t) => window.__sim && (window.__sim.time >= t || window.__sim.gameOver), sec, { timeout: 300000 });
    if (await page.evaluate(() => window.__sim.gameOver)) return false;
    await shot(name);
    return true;
  };
  for (const [t, name] of [[3, '03-floor-1'], [14, '04-fight'], [40, '05-later'], [90, '06-deeper'], [160, '07-deep']]) {
    if (!(await at(t, name))) break;
  }
  await page.waitForFunction(() => window.__sim && window.__sim.gameOver, null, { timeout: 600000 }).catch(() => undefined);
  await page.waitForSelector('.death', { timeout: 10000 }).catch(() => undefined);
  await page.waitForTimeout(300);
  await shot('09-death');
  // Landscape, the way two thumbs hold a phone.
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto(`http://localhost:${port}/?bot=1&speed=3&seed=777&lang=${lang}`);
  await page.getByRole('button', { name: say('Pelaa', 'Play'), exact: true }).click();
  await page.getByRole('button', { name: new RegExp(say('Nuohooja', 'The Sweep')) }).click();
  await page.waitForFunction(() => window.__sim && (window.__sim.time >= 20 || window.__sim.gameOver), null, { timeout: 300000 });
  await shot('10-landscape');
  const perf = await page.evaluate(() => window.__perf);
  console.log(`frames ${perf.frames}, avg ${(perf.ms / perf.frames).toFixed(2)} ms, worst ${perf.worst.toFixed(1)} ms (sim+render, headless)`);
  if (errors.length) console.log('page errors:\n' + errors.join('\n'));
} finally {
  await browser.close();
  server.kill();
}
